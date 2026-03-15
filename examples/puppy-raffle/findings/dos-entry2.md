---
severity: [M-2]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
### Title
The total amount of player inside a raffle is limited

### Description
When a single users is joining a raffle by calling the `enterRaffle` function, his address is added to the `players` list. This call doesn't cost much gas.
However, the duplicates checking loop, will go through all the existing players of the list to check if the new player already exists.
For every new player entering the raffle, the cost will be higher, leading to 2 issues:
- The price to enter the raffle will be very high for the last players compared to thee firsts to enter.
- At some point, users will not be able to enter the raffle because the transaction gas cost will be too high.
After some tests, we found that the maximum total amount of players that can enter the raffle is .

### Proof of Concept
Actors:
- Players: Normal players entering the raffle.
- Last Player: Normal player that can not enter the raffle.

```javascript
function test_NoPlayerCanEnter() public {
    // Create a list of 242 players to fill the array (max simultaneously)
    address[] memory players = new address[](242);
    for (uint256 i = 0; i < 242; i++) {
        players[i] = address(uint160(i+1));
    }

    // 242 players enter the raffle simultaneously
    puppyRaffle.enterRaffle{value: players.length * entranceFee}(players);

    // Now 26 players enter the raffle one by one, paying a lot of gas
    for (uint256 i = 0; i < 26; i++) {
        address[] memory newPlayer = new address[](1);
        newPlayer[0] = address(uint160(i+243));

        puppyRaffle.enterRaffle{value: entranceFee}(newPlayer);
    }

    // The 269th player tries to enter the raffle, but the gas cost is too high
    address[] memory lastPlayer = new address[](1);
    lastPlayer[0] = address(uint160(269));

    // We log the gas here
    uint256 gasBefore;
    uint256 gasAfter;
    uint256 usedGas;
    gasBefore = gasleft();
    puppyRaffle.enterRaffle{value: entranceFee}(lastPlayer);
    gasAfter = gasleft();

    // The transaction will revert
    usedGas = gasBefore - gasAfter;
    assertGt(usedGas, 30_000_000);
}
```

### Recommended Mitigation
We should remove the duplicate check loop. In Ethereum blockchain, people can create as many addresses as they want. So if they want to enter multiple times the raffle, they will still be able to anyway.
Another advice would be to use mappings instead of arrays.