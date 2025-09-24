# audit-report-gen

A CLI tool for smart contract auditors to generate professional PDF security reports from Markdown findings and JSON metadata.

---

## Installation

```bash
npm install
npm link   # makes `audit-report` available globally
```

---

## Usage

```
audit-report generate <input-dir> [options]
```

**Arguments**

| Argument      | Description                                      |
|---------------|--------------------------------------------------|
| `<input-dir>` | Directory containing your report input files     |

**Options**

| Option                | Description                          | Default       |
|-----------------------|--------------------------------------|---------------|
| `-o, --output <file>` | Output PDF path                      | `report.pdf`  |
| `-V, --version`       | Print version                        |               |
| `-h, --help`          | Show help                            |               |

**Example**

```bash
audit-report generate ./examples/puppy-raffle -o puppy-raffle-report.pdf
```

---

## Input Directory Structure

```
my-audit/
├── metadata.json          # Required — report metadata
├── findings/              # Required — one .md file per finding
│   ├── H-01.md
│   ├── H-02.md
│   └── M-01.md
├── about.md               # Optional — auditor bio
├── disclaimer.md          # Optional — custom disclaimer (default provided)
├── protocol-summary.md    # Optional — protocol overview
├── executive-summary.md   # Optional — extra executive summary content
└── logo.svg               # Optional — protocol logo (SVG, PNG, or JPG)
```

---

## metadata.json

```json
{
  "title": "PuppyRaffle Security Review",
  "protocol": "PuppyRaffle",
  "protocolType": "NFT / Raffle",
  "auditors": "John Doe",
  "logo": "logo.svg",
  "date": {
    "from": "2024-01-01",
    "to": "2024-01-14"
  },
  "repo": "https://github.com/example/puppy-raffle",
  "commitHash": "abc123def456...",
  "fixesCommitHash": "def456abc123...",
  "version": "1.0",
  "scope": [
    "src/PuppyRaffle.sol"
  ]
}
```

| Field             | Type             | Required | Description                                  |
|-------------------|------------------|----------|----------------------------------------------|
| `title`           | string           | No       | Report title (used in PDF metadata)          |
| `protocol`        | string           | Yes      | Protocol name shown on the cover page        |
| `protocolType`    | string           | No       | Protocol type (e.g. "DeFi / AMM")            |
| `auditors`        | string or array  | Yes      | Auditor name(s)                              |
| `logo`            | string           | No       | Logo filename (auto-detected if omitted)     |
| `date.from`       | string           | No       | Audit start date                             |
| `date.to`         | string           | No       | Audit end date                               |
| `repo`            | string           | No       | GitHub/GitLab repository URL                 |
| `commitHash`      | string           | No       | Commit hash of the reviewed code             |
| `fixesCommitHash` | string           | No       | Commit hash after fixes were applied         |
| `version`         | string           | No       | Audit version                                |
| `scope`           | array of strings | No       | In-scope file paths                          |

---

## Finding Format

Each finding is a standalone `.md` file in the `findings/` directory. Filenames don't affect ordering — findings are always sorted by severity then by id number from the frontmatter.

### YAML Frontmatter (required)

```yaml
---
severity: [H-1]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
```

| Field                | Required | Values                                                                       |
|----------------------|----------|------------------------------------------------------------------------------|
| `severity`           | Yes      | `[H-1]`, `[M-2]`, `[L-3]`, `[I-1]`, `[G-1]` — code + number in brackets      |
| `status`             | No       | `Pending` (default), `Fixed`, `Acknowledged`, `Won't Fix`                    |
| `affected-contracts` | No       | Free text, e.g. `PuppyRaffle.sol, ReentrancyGuard.sol`                       |

**Severity codes:**

| Code | Severity      |
|------|---------------|
| `H`  | High          |
| `M`  | Medium        |
| `L`  | Low           |
| `I`  | Informational |
| `G`  | Gas           |

### Sub-section labels

Use `**Label**` on its own line (or `### Label`) to create styled section headers. Recognized labels:

| Label                    | Style       |
|--------------------------|-------------|
| `Title`                  | Dark navy   |
| `Description`            | Blue        |
| `Detailed Description`   | Blue        |
| `Impact`                 | Red         |
| `Root Cause`             | Yellow      |
| `Proof of Concept`       | Purple      |
| `PoC`                    | Purple      |
| `Recommended Mitigation` | Green       |
| `Mitigation`             | Green       |
| `Recommendation`         | Green       |
| `Acknowledgement`        | Gray        |
| `Acknowledgment`         | Gray        |

`**Title**` is special: the line immediately after it becomes the finding title shown in the card header and summary table.

### Complete finding example

```markdown
---
severity: [H-1]
status: Fixed
affected-contracts: PuppyRaffle.sol
---
**Title**
Reentrancy in `refund` allows attacker to drain the contract

**Description:**
The `refund` function sends ETH to `msg.sender` before zeroing the player slot...

**Impact:**
An attacker can drain the entire contract balance.

**Proof of Concept:**

```solidity
fallback() external payable {
    if (address(puppyRaffle).balance > 0) {
        puppyRaffle.refund(attackerIndex);
    }
}
```

**Recommended Mitigation:**

```diff
-   payable(msg.sender).sendValue(entranceFee);
    players[playerIndex] = address(0);
+   payable(msg.sender).sendValue(entranceFee);
```
```

---

## Optional Markdown Sections

All section files support full Markdown including code blocks, tables, and lists.

### `about.md`
Auditor bio, shown as a dedicated section after the table of contents.

### `disclaimer.md`
Custom legal disclaimer. If omitted, a default disclaimer is used.

### `protocol-summary.md`
Overview of the audited protocol (architecture, purpose, actors).

### `executive-summary.md`
Additional content appended to the Executive Summary section (after the scope table).

---

## Severity Classification

The report includes a risk matrix based on Impact × Likelihood:

|                     | Impact: High | Impact: Medium | Impact: Low |
|---------------------|--------------|----------------|-------------|
| **Likelihood: High**   | High         | High           | Medium      |
| **Likelihood: Medium** | High         | Medium         | Low         |
| **Likelihood: Low**    | Medium       | Low            | Low         |

The highest severity used in this tool is **High**. There is no "Critical" label.

---

## Example

The `examples/puppy-raffle/` directory contains a complete working example. Run it with:

```bash
audit-report generate ./examples/puppy-raffle -o puppy-raffle.pdf
```
