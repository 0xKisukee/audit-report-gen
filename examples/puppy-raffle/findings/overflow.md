---
severity: [H-6]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
**Title:**

Overflow can cause a permanent loss of fees

**Description:**

Everytime the `selectWinner` function is called, the `totalFees` variable is incremented:
```javascript
uint256 fee = (totalAmountCollected * 20) / 100;
totalFees = totalFees + uint64(fee);
```
The `fee` variable is an `uint256` casted to an `uint64`. This cast is not safe because the value can be higher than 2^64, which would lead to an overflow. Now everytime the `totalFees` exceed 2^64, it will reset to 0, causing a permanent funds loss.

**Proof of Concept:**

Actors:
- Players: Normal players entering the raffle.

```javascript
function test_FeeOverflow() public {
    // We deploy a new contract with high entrance fee
    uint256 hugeEntranceFee = 100 * 1e18;
    puppyRaffle = new PuppyRaffle(
        hugeEntranceFee,
        feeAddress,
        duration
    );

    // 4 players enter the raffle
    address[] memory players = new address[](4);
    players[0] = playerOne;
    players[1] = playerTwo;
    players[2] = playerThree;
    players[3] = playerFour;
    puppyRaffle.enterRaffle{value: 4 * hugeEntranceFee}(players);
    vm.warp(block.timestamp + duration);

    // Now we select a winner and log totalFees
    puppyRaffle.selectWinner();
    uint totalFees = puppyRaffle.totalFees();
    uint expectedFees = (4 * hugeEntranceFee * 20) / 100;

    // `totalFees` is way less than expected fees.
    assertLt(totalFees, expectedFees);
}
```

**Recommended Mitigation:**

We advice the protocol to use a newer version of Solidity to handle overflows and revert.
An even better solution would be remove the cast to `uint64` as it is useless.