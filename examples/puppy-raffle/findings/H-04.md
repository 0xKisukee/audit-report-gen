---
severity: [H-4]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
**Title:**

The `refund` function is not following the Checks-Effects-Interactions pattern, leading to reentrancy vulnerability

**Description:**

The `refund` function is sending Ether to `msg.sender` before setting its address to zero in the `players` array. However, this is the only condition used by the `refund` function to check if a user already got refunded:
```javascript
require(playerAddress != address(0), "PuppyRaffle: Player already refunded, or is not active");
```

Now an attacker can use a malicious contract to call the `refund` function multiple times through a fallback function, letting him drain all the contract balance with reentrancy.

**Impact:**

An attacker can drain the entire contract balance via reentrancy.

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
