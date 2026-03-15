---
severity: [H-3]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
### Title
The `withdrawFees` function may always revert due to integer truncation dust, permanently locking protocol fees

### Description
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

### Impact
Protocol fees are permanently locked in the contract, making the fee receiver unable to claim their revenue.

### Proof of Concept
To achieve that, we just need to change the `entranceFee` of the raffle contract. Right now the tests are successful because the fee is set to 1e18 which is leading to multiples of 5 in most cases. But if we set the variable to this value, the tests will now fail:
```javascript
uint256 entranceFee = 1e18 + 1;
```

### Recommended Mitigation
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
