# Experience Report: Delegated Target Allocation Updates

## Objective

Exercise the delegated `setTargetAllocation` flow end-to-end on mainnet for portfolio84, improving the yield-seeking allocation and documenting the operational gaps encountered.

## Setup

- **Prerequisite**: Delegate key generated, smart wallet provisioned, and delegation invitation redeemed — see [ymax-agent-onboarding-experience-report.md](./ymax-agent-onboarding-experience-report.md)
- **Portfolio**: `portfolio84` on `ymax0` (Agoric mainnet)
- **Delegate**: `delegate-portfolio84` (allocation-only authority)
- **Tool**: `wallet-admin.ts` + `delegated-set-target-allocation.ts` from the built agoric-sdk worktree
- **Environment**: `AGORIC_NET=main,agoric-3`, mnemonic from `.secrets/ymax-agent-portfolio84.env`

## Delegated Allocation Update: flow4 Complete Through Planning, CCTP Bridge In Flight

A delegated yield-seeking allocation update was submitted and confirmed on-chain for portfolio84. Three `setTargetAllocation` transactions were broadcast, with the final allocation progressing through the rebalance solver — successfully passing the planning phase and advancing to CCTP bridge execution (flow4, step 2). On-chain state updated: `policyVersion` incremented from 1 to 3, `flowCount` from 1 to 4, and the portfolio vstorage accepted the new target allocation. Last tx: `324AAC781CC8B872A0941F6840A74D33488CACD33A2EA97696541B1B1D4E3156`.

| Field | Before | After |
|---|---|---|
| Weighted APY (current) | 7.59% | ~8.05% |
| Policy version | 1 | 3 |
| Flow count | 1 | 4 |

The allocation was also used to validate the contract's mandate enforcement: the delegation contract correctly rejects instrument keys outside the portfolio's allowed set, and the wallet-store proxy correctly serializes all instrument keys as bigints.

## Findings

### 1. Instrument Key Set Must Be Discovered Live

The initial allocation draft (`allocations-ymax-initial-yield-seeking.json`) had 11 instrument keys including zeros for unused Aave instruments. The on-chain `targetAllocation` only had 7 keys. The delegation contract audits keys against the current target allocation and rejects any submission with extra or missing keys (`delegation.exo.ts:111-116`). The allowed key set must be queried from the live portfolio first.

### 2. `setTargetAllocation` Args Collapse Through the Marshal Layer

The script called `delegate.setTargetAllocation(targetAllocation, syncState)` with two positional arguments. The `wallet-store.ts` proxy serializes these into an `invokeEntry` bridge message, and Agoric's marshal/pass-style layer passes multiple positional args as fields of a single object. The error:

```
Must have missing properties ["targetAllocation","syncState"]
```

Fix: call `setTargetAllocation({ targetAllocation, syncState })` with a single struct.

### 3. Rebalance Solver Rejects Certain Delta Patterns

| Flow | Allocation (Clear/Hyper/Alpha/Gauntlet/Steak/CompBase/CompOp) | Result |
|---|---|---|
| flow2 | 28/18/12/14/8/7/13 | No feasible solution |
| flow3 | 30/20/12/15/8/7/8 | No feasible solution |
| flow4 | 28/20/15/15/10/10/2 | Running (CCTP bridge step) |

The solver error shows arc constraints like `"Compound_Base->@Base", via: 1_471_156` in microdollar atomic units. At $45 portfolio TVL these are not liquidity caps but internal solver modeling constraints. The solver is sensitive to the delta pattern — large allocation shifts between chains may not find a feasible routing matrix even when absolute amounts are small.

### 4. Activity Page Never Reflects Delegated Submissions

Three confirmed on-chain `setTargetAllocation` transactions do not appear on the YMax activity page. The `POST /transactions` endpoint accepted the tx hashes but with `portfolioId: null` and `invitationMaker: null`, and there is no update path. The flow key is only generated after the contract processes the invocation, so it cannot be included at registration time.

## Updated Runbook

1. Query live portfolio to discover exact current target allocation key set.
2. Build allocation file using only those keys.
3. Call `setTargetAllocation({ targetAllocation, syncState })` with a single struct.
4. Start with minimal deltas to avoid solver infeasibility.
5. Monitor flow state via `GET /portfolios/{portfolioId}/flows/flow{N}`.
6. If solver fails with "No feasible solution", reduce delta magnitude and retry.
7. Register tx hash with `POST /transactions` including `portfolioId` and `flowKey` if known.

## Files

- `allocations-portfolio84-yield-optimized.json` — final candidate allocation (28/20/15/15/10/10/2)
- `delegated-set-target-allocation.ts:128` — patched from two positional args to single struct
