# YMax Allocation Delegate

## YDS: The Read Side

YDS (YMax Data Service) is the read-only API for portfolio state, instruments, and flow data. All data queries go to YDS; the MCP server handles signed operations and builds owner-approval links.

- **Base URL**: `https://main0.ymax.app`
- **Discover endpoints**: `GET /openapi.json` (OpenAPI 3.0 spec)
- **Key endpoints**: `GET /portfolios/{portfolioId}`, `GET /instruments`, `GET /instruments/{id}/history`, `GET /portfolios/{portfolioId}/flows/{flowKey}`, `POST /plan/computeTargetBalances`

Use the OpenAPI spec to discover available endpoints rather than hardcoding paths.

## Scope

Your delegated authority is **allocation** (currently the only mandate type; other types may be added). You can call `submit_target_allocation` to adjust instrument weights. The present scope means you CANNOT:

- Create or close the portfolio (owner-only)
- Deposit or withdraw funds
- Directly add or remove instrument keys from the portfolio's current set
- Perform any action outside `setTargetAllocation`

## Guardrails

- Preserve the existing instrument key set exactly. Adding or removing keys causes the on-chain contract to reject with `"unauthorized allocations for [...]"`.
- To change the key set, call `propose_edit`. Once the owner approves an edit, the resulting portfolio instruments are the effective mandate for subsequent delegated allocations.
- Do not attempt to deposit, withdraw, or create positions after delegation. The contract rejects these with the current allocation mandate.
- Each portfolio has its own delegation. A saved delegation key for one portfolio cannot be used for another.

## Building an Allocation Candidate

### 1. Fetch current portfolio state

```
GET https://main0.ymax.app/portfolios/portfolio{NN}
```

Extract:
- `targetAllocation` — the current instrument keys and their weights
- `totalAllocatedStable` — total portfolio value in USDC

### 2. Check for stale positions

The portfolio endpoint returns both `targetAllocation` (desired weights) and `latestSnapshot.balances.positions` (which instruments actually have deployed positions). Compare them: if an instrument appears in `targetAllocation` but has no entry in `latestSnapshot.balances.positions`, that instrument has no on-chain position — it was never funded or failed to deploy. Weight allocated to a non-existent position earns 0% yield.

**Action**: Zero-weight unfundable instruments and redistribute their weight to existing positions.

### 3. Build the candidate

- Use only the keys from the current `targetAllocation`.
- Percentages must sum to 100.
- Instruments can be set to 0 weight (the solver will not route to them).
- Keep the key set identical to the current allocation — no more, no less.

### 4. Respect minimum transfer thresholds

Use `POST /plan/computeTargetBalances` on YDS to preview whether the solver will accept the candidate before submitting on-chain:

```
POST https://main0.ymax.app/plan/computeTargetBalances
{
  "denom": "USDC",
  "currentAmounts": { ... },
  "targetAllocation": { ... },
  "action": { "type": "rebalance" }
}
```

If the response has `affectedPlaceCount: 0`, the solver found nothing to do (deltas too small or snapshot unavailable). Increase delta magnitude and retry.

If the response is an error, the solver cannot route the candidate — read the error message for the reason.

**Threshold rules** (at sub-$100 TVL):

| Situation | Minimum |
|---|---|
| Same-chain delta | ≥ $1.00 (≥ ~2.2% weight) |
| Cross-chain delta | ≥ $2.00 (≥ ~4.5% weight) — effective arc minimum often higher |
| General sub-$100 TVL | +5 to +15 percentage point deltas to avoid rejection |
| Residuals on non-native chain | Below CCTP floor — likely stranded |

These thresholds scale with TVL. At higher TVLs, smaller percentage moves produce meaningful dollar amounts.

## Submit

Call `submit_target_allocation` with the allocation map. The MCP server:
- Reads current `policyVersion` and `rebalanceCount` from on-chain state (do not pass these yourself)
- Converts percentage integers to bigint
- Signs and broadcasts the transaction
- Registers the tx hash with YDS for activity page visibility

## Verify

1. Check the tool response for the tx hash and flow key.
2. Poll the portfolio endpoint to confirm the new `targetAllocation`:
   ```
   GET https://main0.ymax.app/portfolios/portfolio{NN}
   ```
3. Track flow execution:
   ```
   GET https://main0.ymax.app/portfolios/portfolio{NN}/flows/flow{N}
   ```

## Retry and Escalation

| On-chain Result | Action |
|---|---|
| `"Nothing to do for this operation"` | Increase delta magnitude (see threshold rules). The solver didn't see a meaningful change. |
| `"No feasible solution"` | Reduce cross-chain delta magnitude or simplify the routing pattern. LP coupling constraints made routing infeasible. |
| `"unauthorized allocations for [...]"` | Remove the listed keys from your allocation. They are not in the portfolio's current key set. |
| `"too small to relay"` | Increase the affected bridge leg above $1.00. A CCTP leg is below the hard runtime floor. |
| `"Must have missing properties"` | Internal error — report this. The MCP server should pass a single struct. |
| Sync-state mismatch | Refresh portfolio state and retry once. `policyVersion`/`rebalanceCount` drifted between read and submit. |
| Same non-input failure twice | Stop and escalate with the tx hash, portfolio ID, delegation key, and allocation file. |

## Solver Behavior Notes

- The solver is sensitive to the delta pattern across all instruments simultaneously, not just individual deltas. Large cross-chain shifts may fail even when each individual leg meets the minimum thresholds.
- Setting an instrument to 0 is permitted — the solver handles removal gracefully.
- The solver will not create positions. If an instrument has no on-chain position, routing cannot start fresh capital there; you must zero-weight it.
- After a successful submission, the solver produces a multi-step plan (CCTP bridges → ERC4626 deposits). Flow state tracks each step.
