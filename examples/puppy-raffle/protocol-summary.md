PuppyRaffle is a raffle protocol where participants can enter to win a cute dog NFT. The protocol allows users to enter by paying an entrance fee, and a winner is selected pseudo-randomly after the raffle duration elapses.

## Roles

- **Owner:** Deployer of the protocol. Has the power to change the wallet address to which fees are sent through the `changeFeeAddress` function.
- **Player:** Participant of the raffle. Can enter the raffle with the `enterRaffle` function and request a refund through the `refund` function.
