---
severity: [I-1]
status: Acknowledged
affected-contracts: PuppyRaffle.sol
---
**Title:**

The `_isActivePlayer` internal function is never used

**Description**

This is consuming gas by increasing compiled code size.

**Recommended Mitigation:**

Delete this function.
