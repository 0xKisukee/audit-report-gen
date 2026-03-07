---
severity: [L-1]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
**Title:**

The amount of players that can enter the raffle simultaneously is limited

**Description:**

When a list of users are joining a raffle by calling the `enterRaffle` function, each player is added to the `players` list one by one with a for loop. The bigger the `newPlayers` array is, the more gas the transaction will use.
There is also the duplicates checking loop, this one is a double nested for loop which is exponentially more costly in term of gas.
Ethereum blocks have a maximum size of 30 million gas, which means that the transaction will always revert if the players amount is too high. Let's see how many players can enter the raffle.
After some tests, we found that the maximum amount of players that can enter the raffle simultaneously is 241.

**Proof of Concept:**

Actors:
- Players: Normal players entering the raffle.

```javascript
function test_MaxPlayersToEnter() public {
    // We create a list of 242 players
    address[] memory players = new address[](242);
    for (uint256 i = 0; i < 242; i++) {
        players[i] = address(uint160(i+1));
    }

    // The 242 players try to enter the raffle
    // and we save the gas used for the transaction
    uint256 gasBefore = gasleft();
    puppyRaffle.enterRaffle{value: players.length * entranceFee}(players);
    uint256 gasAfter = gasleft();

    // The transaction will revert
    uint256 usedGas = gasBefore - gasAfter;
    assertGt(usedGas, 30_000_000);
}
```

**Recommended Mitigation:**

We advice the protocol to limit the array size in the frontend to avoid transations reverting. It should also be specified in the docs. If people want to enter more than 242 players, they should call multiple transactions, but they will still be limited at some point (see M-2).