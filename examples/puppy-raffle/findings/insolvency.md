---
severity: [H-1]
status: Acknowledged
affected-contracts: PuppyRaffle.sol
---
**Title:**

When a player asks for a refund, the `totalAmountCollected` variable is not reduced, causing contract insolvency

**Description:**

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

**Impact:**

Funds can be permanently locked in the contract, making the protocol insolvent after any refund.

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
+   uint256 zeroAddressCount = 0;
+   for (uint256 i = 0; i < players.length; i++) {
+       if (players[i] == address(0)) {
+           zeroAddressCount++;
+       }
+   }
-   uint256 totalAmountCollected = players.length * entranceFee;
+   uint256 totalAmountCollected = (players.length - zeroAddressCount) * entranceFee;
```
