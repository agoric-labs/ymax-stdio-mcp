# yield1

Onboarding and mandate-enforcement testing for a YMax cross-chain yield allocation delegate on Agoric mainnet.

## Reports

- **[ymax-agent-onboarding-experience-report.md](./ymax-agent-onboarding-experience-report.md)** — Documents the end-to-end onboarding of a delegated YMax allocation agent for `portfolio84`, including wallet creation, funding, smart-wallet provisioning, and invitation redemption.
- **[experience-report-target-allocation.md](./experience-report-target-allocation.md)** — Exercises the delegated `setTargetAllocation` flow end-to-end on mainnet, including instrument key set discovery, API marshalling correction, and iterative allocation optimization through the rebalance solver.
- **[experience-report-mandate-enforcement.md](./experience-report-mandate-enforcement.md)** — Verifies that the contract rejects `setTargetAllocation` requests targeting instrument keys outside the portfolio's allowed set.
