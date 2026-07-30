# Experience Reports

Findings and lessons from live YMax mainnet operation with `portfolio84`.

## Reports

- **[ymax-agent-onboarding-experience-report.md](./ymax-agent-onboarding-experience-report.md)** — End-to-end onboarding of a delegated YMax allocation agent: wallet creation, funding, smart-wallet provisioning, and invitation redemption.
- **[experience-report-target-allocation.md](./experience-report-target-allocation.md)** — First delegated `setTargetAllocation` flow: instrument key set discovery, API marshalling, and iterative optimization through the rebalance solver.
- **[experience-report-mandate-enforcement.md](./experience-report-mandate-enforcement.md)** — Verification that the contract rejects `setTargetAllocation` requests targeting instrument keys outside the portfolio's allowed set.
- **[experience-report-iterative-allocation-tweaks.md](./experience-report-iterative-allocation-tweaks.md)** — Two iterative allocation tweaks that raised target APY from 7.57% to 8.15%, resolved a stale AlphaCore position, and documented solver behavior under different delta patterns.
