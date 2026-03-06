---
severity: [H-1]
status: Acknowledged
affected-contracts: PuppyRaffle.sol
---
**Title**
When a player asks for a refund, the `totalAmountCollected` variable is not reduced, causing contract insolvency

**Description:**

When a player calls the `refund` function to get his money back, the `players` array's size stays the same. However, the prize pool is calculated with this formula:
```javascript
totalAmountCollected = players.length * entranceFee
```

In reality, the contract balance is only `(players.length - 1) * entranceFee` because of the refund. Now if we call the `selectWinner` function, the transaction will revert on the call:
```javascript
(bool success,) = winner.call{value: prizePool}("");
require(success, "PuppyRaffle: Failed to send prize pool to winner");
```

This does mean that the funds are permanently locked in the contract. The only way to recover them is to send some Ether to the contract, to make its balance greater than or equal to the prize pool.

**Impact:**

Funds can be permanently locked in the contract, making the protocol insolvent after any refund.

**Proof of Concept:**

Actors:
- Players: Normal players entering the raffle.

```javascript
function test_RaffleBurnPrize() public {
    address[] memory players = new address[](4);
    players[0] = playerOne;
    players[1] = playerTwo;
    players[2] = playerThree;
    players[3] = playerFour;
    puppyRaffle.enterRaffle{value: entranceFee * 4}(players);

    uint256 indexOfPlayerOne = puppyRaffle.getActivePlayerIndex(playerOne);
    vm.prank(playerOne);
    puppyRaffle.refund(indexOfPlayerOne);

    vm.warp(block.timestamp + duration);
    vm.expectRevert("PuppyRaffle: Failed to send prize pool to winner");
    puppyRaffle.selectWinner();

    uint256 totalAmountCollected = players.length * puppyRaffle.entranceFee();
    assertGt(totalAmountCollected, address(puppyRaffle).balance);
}
```

**Recommended Mitigation:**

Track the zero addresses inside of the players array. Make these changes inside of the `selectWinner` function:

```diff
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
severity: [H-2]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
**Title**
Refunding a user zeroes its address in the `players` array, causing a revert on all new entries when two or more users have refunded

**Description:**

When a user asks for a refund, the `refund` function replaces their address with the zero address in the array. If multiple users refund, there will be multiple zero addresses. When another user then calls `enterRaffle`, the duplicate check loop will revert:

```javascript
for (uint256 i = 0; i < players.length - 1; i++) {
    for (uint256 j = i + 1; j < players.length; j++) {
        require(players[i] != players[j], "PuppyRaffle: Duplicate player");
    }
}
```

This leads to two major issues:

1. Users cannot enter a raffle where 2 players have refunded, causing a DoS until `selectWinner` clears the array.
2. If two players refund before 4 players have entered, `selectWinner` can never be called, permanently locking the remaining player's funds.

**Impact:**

Denial of service on new raffle entries. In the worst case the contract is permanently unusable.

**Proof of Concept:**

```javascript
function test_RaffleDoS() public {
    address[] memory player_1 = new address[](1);
    player_1[0] = playerOne;
    puppyRaffle.enterRaffle{value: entranceFee}(player_1);

    address[] memory attackers = new address[](2);
    attackers[0] = attackerOne;
    attackers[1] = attackerTwo;
    puppyRaffle.enterRaffle{value: entranceFee * 2}(attackers);

    uint256 indexOfAttackerOne = puppyRaffle.getActivePlayerIndex(attackerOne);
    vm.prank(attackerOne);
    puppyRaffle.refund(indexOfAttackerOne);

    uint256 indexOfAttackerTwo = puppyRaffle.getActivePlayerIndex(attackerTwo);
    vm.prank(attackerTwo);
    puppyRaffle.refund(indexOfAttackerTwo);

    address[] memory player_2 = new address[](1);
    player_2[0] = playerTwo;
    vm.expectRevert("PuppyRaffle: Duplicate player");
    puppyRaffle.enterRaffle{value: entranceFee}(player_2);
}
```

**Recommended Mitigation:**

Skip zero addresses in the duplicate check:
```diff
for (uint256 i = 0; i < players.length - 1; i++) {
+   if (players[i] == address(0)) continue;
    for (uint256 j = i + 1; j < players.length; j++) {
        require(players[i] != players[j], "PuppyRaffle: Duplicate player");
    }
}
```
---
severity: [H-3]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
**Title**
The `withdrawFees` function may always revert due to integer truncation dust, permanently locking protocol fees

**Description:**

The `withdrawFees` function checks that the contract balance equals `totalFees` to ensure no active players remain:
```javascript
require(address(this).balance == uint256(totalFees), "...");
```

The fee calculation in `selectWinner` uses integer division:
```javascript
uint256 fee = (totalAmountCollected * 20) / 100;
```

When `totalAmountCollected` is not a multiple of 5, truncation leaves dust in the contract. Because `address(this).balance` will always be slightly higher than `uint256(totalFees)`, the require will revert every time.

**Impact:**

Protocol fees are permanently locked in the contract, making the fee receiver unable to claim their revenue.

**Proof of Concept:**

Set `entranceFee = 1e18 + 1`. The truncated dust will make `withdrawFees` revert indefinitely.

**Recommended Mitigation:**

Replace the balance equality check with a player count check:
```diff
function withdrawFees() external {
-   require(address(this).balance == uint256(totalFees), "PuppyRaffle: There are currently players active!");
+   require(players.length == 0, "PuppyRaffle: There are currently players active!");
    uint256 feesToWithdraw = totalFees;
    totalFees = 0;
    (bool success,) = feeAddress.call{value: feesToWithdraw}("");
    require(success, "PuppyRaffle: Failed to withdraw fees");
}
```
---
severity: [H-4]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
**Title**
The `refund` function violates the Checks-Effects-Interactions pattern, enabling reentrancy to drain the contract

**Description:**

The `refund` function sends ETH to `msg.sender` before zeroing their slot in the `players` array. The only guard against double-refund is:
```javascript
require(playerAddress != address(0), "PuppyRaffle: Player already refunded, or is not active");
```

An attacker can deploy a contract with a fallback function that re-enters `refund` before the slot is zeroed, draining the full contract balance.

**Impact:**

An attacker can drain the entire contract balance via reentrancy.

**Proof of Concept:**

```javascript
function test_RaffleReentrancy() public playersEntered {
    vm.startPrank(attackerOne);
    MaliciousContract maliciousContract = new MaliciousContract(puppyRaffle);
    vm.deal(address(maliciousContract), entranceFee);
    maliciousContract.startAttack();
    maliciousContract.withdraw();
    vm.stopPrank();

    assertEq(attackerOne.balance, balanceBefore + 5 * entranceFee);
}
```

**Recommended Mitigation:**

Apply the Checks-Effects-Interactions pattern:
```diff
-   payable(msg.sender).sendValue(entranceFee);
    players[playerIndex] = address(0);
+   payable(msg.sender).sendValue(entranceFee);
```
---
severity: [M-1]
status: Pending
affected-contracts: PuppyRaffle.sol
---
**Title**
Poor RNG implementation can be exploited by attackers to choose the winner

**Description:**

`selectWinner` derives randomness from predictable on-chain variables:
```javascript
uint256 winnerIndex =
    uint256(keccak256(abi.encodePacked(msg.sender, block.timestamp, block.difficulty))) % players.length;
uint256 rarity = uint256(keccak256(abi.encodePacked(msg.sender, block.difficulty))) % 100;
```

Both values can be pre-computed before broadcasting the transaction, allowing a malicious actor to call `selectWinner` only when they would win, or to farm rare NFTs by waiting for `rarity > LEGENDARY_RARITY`.

**Impact:**

Malicious actors can manipulate raffle outcomes to guarantee winning and farm rare NFTs.

**Proof of Concept:**

```javascript
while (winnerIndex != attackerOneIndex && winnerIndex != attackerTwoIndex) {
    vm.roll(block.number + 1);
    vm.warp(block.timestamp + 8);
    winnerIndex = uint256(keccak256(abi.encodePacked(
        attackerOne, block.timestamp, block.difficulty
    ))) % 6;
}
vm.prank(attackerOne);
puppyRaffle.selectWinner();
```

**Recommended Mitigation:**

Use Chainlink VRF or another verifiable on-chain randomness oracle.
---
severity: [I-1]
status: Acknowledged
affected-contracts: PuppyRaffle.sol
---
**Title**
The `_isActivePlayer` internal function is never used

**Description:**

The `_isActivePlayer` function is declared but never called anywhere in the contract. Dead code increases compiled bytecode size and wastes gas on deployment.

**Recommended Mitigation:**

Delete the `_isActivePlayer` function.
