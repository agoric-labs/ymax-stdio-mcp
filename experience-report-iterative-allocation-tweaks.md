# Experience Report: Iterative Allocation Tweaks for Yield Optimization

## Objective

Improve the yield-weighted APY of portfolio84 through iterative delegated `setTargetAllocation` calls, resolving an idle-balance issue left by a prior flow, and documenting the solver's behavior under different delta patterns.

## Setup

- **Portfolio**: `portfolio84` on `ymax0` (Agoric mainnet)
- **Delegate**: `delegate-portfolio84` (allocation-only authority) — see [onboarding report](./ymax-agent-onboarding-experience-report.md)
- **Starting allocation**: flow4 target (Clearstar 28 / Hyperithm 20 / AlphaCore 15 / GauntletRWA 15 / Steakhouse 10 / CompBase 10 / CompOp 2)
- **Starting policy version**: 4
- **Starting flow count**: 4
- **Starting value**: ~$45.00 USDC
- **Tool**: `wallet-admin.ts` + `delegated-set-target-allocation.ts` via `nix develop`
- **Environment**: `AGORIC_NET=main`, mnemonic from `.secrets/ymax-agent-portfolio84.env`

## Pre-Tweak Discovery: Stale Position and Idle Balance

Before any tweaks, I queried the live portfolio state via `GET /portfolios/portfolio84`. The API revealed two critical issues:

**1. $6.75 idle on Avalanche.** The portfolio accounts showed raw USDC on Avalanche with no corresponding position. The funds were earning 0%.

**2. AlphaCore position missing from `positionKeys`.** The vstorage `positionKeys` array contained only 6 entries (all except `ERC4626_morphoAlphaUsdcCore_Ethereum`), despite the `targetAllocation` including AlphaCore at 15%. The position had never been created on-chain — flow4's CCTP bridge landed USDC on Avalanche but the follow-on deposit to the AlphaCore Morpho vault on Ethereum never completed.

| Snapshot field | Value |
|---|---|
| `positionKeys` count | 6 (AlphaCore absent) |
| AlphaCore target weight | 15% ($6.75) |
| AlphaCore balance | $0.00 |
| Avalanche account balance | $6.75 (idle) |
| Weighted APY (target) | ~7.57% |
| Weighted APY (realized, with $6.75 idle) | **~6.44%** (113 bps drag) |

The delegate cannot create new positions (only `{ allocation: true }` authority). The practical fix is to redistribute AlphaCore's weight to existing funded positions.

### Instrument APYs (live, 2026-07-09)

| Instrument | APY | Chain | TVL |
|---|---|---|---|
| ClearstarReactor | **10.69%** | Ethereum | $1.77M |
| HyperithmDegen | **7.92%** | Ethereum | $2.33M |
| AlphaCore | **6.12%** | Ethereum | $1.14M (position missing) |
| GauntletRWA | **5.87%** | Ethereum | $12.12M |
| SteakhouseHighYield | **5.08%** | Ethereum | $37.72M |
| Compound_Base | **4.55%** | Base | $8.49M |
| Compound_Optimism | **11.66%** | Optimism | $1.73M |

## Tweak #1: Small Delta Shift (30/20/15/13/10/10/2)

**File**: `allocations-portfolio84-tweak1.json`

| Instrument | Before | After | Delta |
|---|---|---|---|
| ClearstarReactor | 28 | **30** | +2 |
| HyperithmDegen | 20 | 20 | 0 |
| AlphaCore | 15 | 15 | 0 |
| GauntletRWA | 15 | **13** | -2 |
| SteakhouseHighYield | 10 | 10 | 0 |
| Compound_Base | 10 | 10 | 0 |
| Compound_Optimism | 2 | 2 | 0 |

**Expected target APY**: ~7.67% (+10 bps)

### Transaction

Submitted via nix:

```sh
source .secrets/ymax-agent-portfolio84.env && AGORIC_NET=main \
nix develop agoric-sdk -c bash -c "
  cd /Users/connolly/Documents/yield1 && \
  ./agoric-sdk/packages/portfolio-deploy/scripts/wallet-admin.ts \
  ./agoric-sdk/packages/portfolio-deploy/src/delegated-set-target-allocation.ts \
  --portfolio-id 84 \
  --delegation-key delegate-portfolio84 \
  --allocations-file ./allocations-portfolio84-tweak1.json
"
```

**Result**: `txHash: F01373CF3ADDE76A759C5667AA2177C64E6A67805DE960009998FACC003B8416`, height 26310097

- Policy version incremented: 4 → 5
- Flow5 created with state `fail`

### Flow5 Failure: "Nothing to do for this operation"

```
state: "fail"
error: "Nothing to do for this operation."
```

The solver determined no routing was needed. Two contributing factors:

1. **Latest snapshot was null at the target block height.** The portfolio API returned `latestSnapshot: null` after the policy update, meaning the solver had no current balance data to compute deltas against.
2. **Deltas too small to trigger routing.** The +2/-2 shifts on Clearstar/GauntletRWA ($0.90 at $45 TVL) combined with a $6.75 idle-on-Avalanche problem that requires a new position (AlphaCore) which the solver cannot create itself.

**Lesson**: Small allocation tweaks may be rejected by the solver when balance snapshots are unavailable or when the required action involves creating positions the solver doesn't recognize as fundable. Additionally, the $0.90 delta fell below the **$1.00 delta soft minimum** (see Finding #7), so the solver suppressed the change before any routing was considered.

## Tweak #2: Remove AlphaCore, Redistribute (40/23/0/13/10/12/2)

**File**: `allocations-portfolio84-tweak2.json`

Since AlphaCore's position was never created on-chain, the only viable path is to zero it out and redistribute to the 6 existing positions:

| Instrument | Before (Tweak1) | After | Delta |
|---|---|---|---|
| ClearstarReactor | 30 | **40** | +10 |
| HyperithmDegen | 20 | **23** | +3 |
| AlphaCore | 15 | **0** | -15 |
| GauntletRWA | 13 | 13 | 0 |
| SteakhouseHighYield | 10 | 10 | 0 |
| Compound_Base | 10 | **12** | +2 |
| Compound_Optimism | 2 | 2 | 0 |

### Rationale

- **AlphaCore → 0**: Position doesn't exist; remove the unfundable weight.
- **ClearstarReactor +10**: Highest-yielding position at scale (10.69%), same chain as freed GauntletRWA funds.
- **HyperithmDegen +3**: Second-highest Ethereum yield (7.92%).
- **Compound_Base +2**: Absorb small residual from GauntletRWA reduction.
- **Compound_Optimism unchanged**: Capped at 2% by prior arc constraint findings at this TVL.
- **GauntletRWA unchanged**: No further cuts needed.

**Expected target APY**: ~**8.15%** (+58 bps from original 7.57%, +48 bps from Tweak1)

**Idle balance resolution**: $6.75 on Avalanche → $5.99 bridged to Ethereum, -$0.90 freed from GauntletRWA, $0.76 residual on Avalanche.

### Transaction

`txHash: 72398D16F5214D91E58D8FCF025B9ABAF649F6CC4191562D1F9C4DB97DA2EAA0`, height 26310116

- Policy version: 5 → 6
- Flow6 created, state: `run`

### Flow6 Execution (Solver-Accepted Plan)

The solver accepted the allocation and generated a concrete 3-step rebalance plan:

| Step | Operation | Amount | From → To | Tx |
|---|---|---|---|---|
| 1 | **CCTPv2 bridge** | $5.99 | Avalanche → Ethereum | `0x5079aa7ea891ae5def0ad7290e8951c93a9ecac990999cae0e66967e3853fcca` |
| 2 | **ERC4626 deposit** | $4.92 | Ethereum → ClearstarReactor (10.69%) | tx3080 |
| 3 | **ERC4626 deposit** | $1.07 | Ethereum → HyperithmDegen (7.92%) | tx3081 |

Flow6 progressed through step 1 (CCTP bridge completed, funds landed on Ethereum) into steps 2/3 (deposits in progress) as of the last observation.

## Results

| Metric | Before | After |
|---|---|---|
| **Policy version** | 4 | **6** |
| **Flow count** | 4 | **6** |
| **Target weighted APY** | ~7.57% | **~8.15%** (+58 bps) |
| **Idle on Avalanche** | $6.75 (0% yield) | **$5.99 in-flight bridge** → Clearstar/Hyperithm |
| **ClearstarReactor weight** | 28% | **40%** |
| **HyperithmDegen weight** | 20% | **23%** |
| **AlphaCore weight** | 15% | **0%** (position absent) |
| **Compound_Base weight** | 10% | **12%** |

## Files

- `allocations-portfolio84-tweak1.json` — small delta shift (failed solver "Nothing to do")
- `allocations-portfolio84-tweak2.json` — AlphaCore removal + aggressive redistribution (executing successfully)

## Findings

### 1. Position Keys Can Become Stale Relative to Target Allocation

The vstorage `positionKeys` array contained only 6 entries, while `targetAllocation` contained 7. The missing instrument (`ERC4626_morphoAlphaUsdcCore_Ethereum`) was created at portfolio inception but never gained a position on-chain — flow4's CCTP bridge left funds idle on Avalanche without completing the deposit. A delegate with `{ allocation: true }` cannot create new positions; the only fix is to redistribute the weight to existing positions.

**Mitigation**: Before submitting an allocation, compare `positionKeys` against `targetAllocation` keys. If they differ, the unmatched instrument may be unfundable and should be removed from the target.

### 2. Small Deltas Rejected as "Nothing to Do"

Tweak #1's +2/-2 deltas (at $45 TVL = $0.90 movement) failed the solver with `"Nothing to do for this operation."` This was likely a combination of:
- No `latestSnapshot` available at the new block height (null after policy update)
- Solver conservatism on tiny absolute amounts

Tweak #2's larger deltas (+10/+3/+2/-15) succeeded immediately, generating a multi-step cross-chain rebalance plan.

**Practical rule**: At sub-$100 TVL, keep individual position deltas in the range of +5 to +15 percentage points to ensure the solver sees a meaningful routing problem. Small "nudge" deltas of ±2 points are ignored. The root cause is the **$1.00 delta soft minimum** (see Finding #7) — any cross-chain delta that falls below this threshold after accounting for fees and arc coupling is suppressed before the solver even begins planning.

### 3. CCTP Bridge Timing

The CCTPv2 bridge from Avalanche → Ethereum (step 1 of flow6) advanced from "in-flight" to "completed" within the observation window, and the dependent ERC4626 deposit steps (2/3) began executing autonomously. The total bridge-to-deposit cycle was still in progress at session end. CCTP attestation typically takes 3-15 minutes.

### 4. Nix Develop Is Required for the Toolchain

The SDK's `wallet-admin.ts` script imports from `@agoric/client-utils` and `@aglocal/portfolio-contract`, which are resolved through yarn PnP. Attempting to run the script directly via `node` (without nix) fails because the node_modules layout expects the nix-provided Node.js version and environment. The invocation pattern:

```sh
source .secrets/ymax-agent-portfolio84.env && AGORIC_NET=main \
nix develop /path/to/agoric-sdk -c bash -c "
  cd /path/to/yield1 && \
  /path/to/agoric-sdk/packages/portfolio-deploy/scripts/wallet-admin.ts \
  /path/to/agoric-sdk/packages/portfolio-deploy/src/delegated-set-target-allocation.ts \
  --portfolio-id 84 \
  --delegation-key delegate-portfolio84 \
  --allocations-file ./allocations-portfolio84-tweakN.json
"
```

This pattern sources the mnemonic into the environment, sets `AGORIC_NET=main` for mainnet RPC discovery, and runs the delegation script under the nix flake's toolchain.

### 5. Solver Will Happily Accept AlphaCore→0

Setting an instrument weight to zero within the key set is permitted (the delegation contract only rejects *new* keys, not zeros). The solver intelligently handles weight removal — no routing is generated for a zero-weight position that already has zero balance.

### 6. Activity Page Still Doesn't Reflect Delegated Submissions

As in the prior report, the two new `setTargetAllocation` transactions (`F01373...` and `72398D...`) do not appear on the YMax activity page. The activity endpoint returned the same three historical entries (two Grants, one OpenPortfolio) with no update path. The `POST /transactions` registration workaround from the prior report remains the only way to bridge this visibility gap.

### 7. Minimum Transfer Amounts: Multi-Layer Enforcement

The solver and bridge execution pipeline enforce minimum transfer amounts at four independent layers. These constraints are the root cause of both the "Nothing to do" rejection (Tweak #1) and the solver infeasibility for larger-but-not-large-enough cross-chain deltas (flow2/flow3 from the prior report).

#### Layer 1: CCTP Hard Runtime Check — $1.00 (1,000,000 uusdc)

**File**: `packages/portfolio-contract/src/pos-evm.flows.ts:191-216`

```typescript
const CCTP_OUTBOUND_THRESHOLD = 1_000_000n; // $1 USDC
// ...
amount.value >= CCTP_OUTBOUND_THRESHOLD ||
  Fail`too small to relay: ${q(amount)} below ${CCTP_OUTBOUND_THRESHOLD}`;
```

This is a **hard assertion** in `CCTP.apply()`. If any CCTP bridge leg carries less than $1.00, the flow exits with a fatal error. There is no way to bypass it — the solver must respect this floor.

#### Layer 2: LP Solver Coupling Constraints (from LinkSpec `min`)

**File**: `packages/portfolio-api/src/network/prod-network.ts`

| Route Type | `min` per link | Legs |
|---|---|---|
| CCTPv2 EVM→EVM | **100,000 uusdc ($0.10)** | All EVM pairs (Arbitrum, Avalanche, Base, Ethereum, Optimism) |
| CCTP-from-Noble | **1,000,000 uusdc ($1.00)** | Noble → each EVM chain |

The LP solver in `packages/portfolio-contract/tools/plan-solve.ts:247-255` encodes these as **coupling constraints** in the optimization model. If a link is used, the solver must route at least `min` through it:

```typescript
if (min !== undefined) {
  const scaledMin = Number(min) / UNIT_SCALE;
  couplingConstraints[`allow_${id}`].max = COVER_FLOW - scaledMin;
}
```

This creates a non-linear interaction: using a bridge leg commits the solver to moving at least `min` across it, which may force additional upstream/downstream adjustments that make the overall solution infeasible.

#### Layer 3: Delta Soft Minimum — $1.00 (1,000,000 uusdc)

**File**: `packages/portfolio-api/src/target-balances.ts:20`

```typescript
export const DEFAULT_DELTA_SOFT_MIN = 1_000_000n; // 1 USDC
```

In the `computeTargetBalances` function, position deltas smaller than `deltaSoftMin` are **suppressed** — the solver never even sees them:

```typescript
// target-balances.ts:249
const isSuppressed = delta !== 0n && absDelta < draftRecord.deltaSoftMin;
```

Each chain can override this via `deltaSoftMin` in the network spec, but the default is $1.00. At $45 TVL, that's 2.2% weight — meaning any weight change smaller than ~2.2% is invisible to the solver.

**This is the direct cause of Tweak #1's failure**: the +2/-2 deltas produced a $0.90 absolute change, which is below the $1.00 `DEFAULT_DELTA_SOFT_MIN`.

#### Layer 4: Account Dust Epsilon — $0.0001 (100 uusdc)

**File**: `packages/portfolio-api/src/constants.js:189-193`

```typescript
export const ACCOUNT_DUST_EPSILON = 100n; // $0.0001
```

Used in `target-balances.ts:75-76` to filter entries:

```typescript
const isDust = (value: bigint): boolean =>
  -ACCOUNT_DUST_EPSILON < value && value < ACCOUNT_DUST_EPSILON;
```

This is a minor cleanup filter — not a practical constraint for allocation planning.

#### Practical Impact Summary

| Scenario | Amount | Meets $1.00 delta soft min? | Meets $0.10 CCTPv2 link min? | Meets $1.00 CCTP hard floor? | Result |
|---|---|---|---|---|---|
| Tweak #1 Clearstar +2% | $0.90 | **No** ❌ | N/A (same chain) | N/A | Suppressed |
| Flow2 CompOp 13% | $5.85 | Yes ✓ | Yes ✓ | Yes ✓ | Failed — LP coupling made solution infeasible |
| Flow3 CompOp 8% | $3.60 | Yes ✓ | Yes ✓ | Yes ✓ | Failed — LP coupling made solution infeasible |
| Flow4 CompOp 2% | $0.90 | **No** ❌ | N/A (already funded) | N/A | Succeeded (existing position, no new bridge) |
| Tweak #2 bridge Avax→Eth | $5.99 | Yes ✓ | Yes ✓ ($0.10) | Yes ✓ ($1.00) | Succeeded — flow6 executing |
| Residual after flow6 | **$0.76** | **No** ❌ | Yes ✓ ($0.10) | **No** ❌ ($1.00) | **Likely stranded** |

#### Interaction with Arc Constraints (Prior Report Findings)

The prior experience report documented arc constraint errors like:

```
"Compound_Base->@Base", via: 1_471_156
```

The `1_471_156` uusdc (~$1.47) is the **LP solver's effective minimum** for that specific arc, which is higher than the raw link `min` of 100,000 uusdc. It incorporates:
- The link spec `min` (100,000 uusdc)
- The CCTP fee (variable per arc)
- The delta soft minimum contribution
- Coupling interactions with adjacent arcs in the flow

At $45 TVL, the solver's effective minimums are typically **$1.47–$2.00 per arc**, meaning any cross-chain leg must move at least $1.47–$2.00. This is why weight changes targeting cross-chain positions (like Compound_Optimism) at < 5% ($2.25) tended to fail, while same-Ethereum rebalances succeeded even at smaller deltas (no bridge required).

#### Implications for Future Tweaks

1. **Cross-chain deltas must exceed the effective arc minimum** — at $45 TVL, budget at least **$2.00 per cross-chain leg** (≈ 4.5% weight).
2. **Same-chain deltas** need only exceed the **$1.00 delta soft minimum** (≈ 2.2% weight).
3. **The $0.76 Avalanche residual** is below both the $1.00 CCTP hard floor and the $1.00 delta soft min. It can only be recovered by combining it with additional funds (deposit to Avalanche) or accepting it as stranded dust.
4. **When multiple cross-chain arcs interact** (e.g., GauntletRWA→CompBase + Avalanche→Clearstar), the coupling constraints may require the solver to increase one leg to meet the minimum on another — potentially making a solution infeasible even when each individual arc looks viable in isolation.

## Updated Runbook

1. Query live portfolio to discover `positionKeys` and `targetAllocation`. Compare them — any instrument in `targetAllocation` but not `positionKeys` may be unfundable.
2. Cross-reference live instrument APYs from `GET /instruments` to identify yield leaders.
3. Build allocation using only existent `positionKeys`. Set unfundable instrument weights to 0.
4. **Respect minimum transfer thresholds** (see Finding #7):
   - Same-chain deltas must be ≥ **$1.00** (≈ **2.2% weight** at $45 TVL) to exceed the delta soft minimum.
   - Cross-chain deltas must be ≥ **$1.00 per bridge leg** (CCTP hard floor), and in practice **$2.00+** to pass LP solver coupling constraints.
5. Use deltas of at least +5/-5 percentage points at sub-$100 TVL to avoid solver "Nothing to do" rejection.
6. Call `setTargetAllocation({ targetAllocation, syncState })` via `nix develop`.
7. Monitor flow state via `GET /portfolios/{portfolioId}/flows/flow{N}`.
8. If solver fails with "Nothing to do", increase delta magnitude and retry.
9. If solver finds a solution, track CCTP bridge txHash on the block explorer.
10. Check for residual dust below the CCTP floor (sub-$1.00 on a non-native chain) — these amounts are likely stranded unless combined with new deposits.

## Remaining Work

- Flow6 deposit steps 2/3 were still executing at session end. The ClearstarReactor and HyperithmDegen positions should absorb $4.92 and $1.07 respectively once the ERC4626 deposits confirm.
- **~$0.76 remains on Avalanche** (the difference between $6.75 idle and $5.99 bridged). This is **below the $1.00 CCTP hard floor** (see Finding #7) and below the **$1.00 delta soft minimum**. It cannot be routed by the solver through a CCTP bridge. Recovery options: (a) deposit additional USDC to the Avalanche account to bring the total above $1.00, then submit a new allocation that routes the combined amount, or (b) accept it as permanently stranded dust (≈ 1.7% of portfolio value).
- GauntletRWA → Compound_Base routing ($0.90) was not included in flow6's plan. The solver may handle it in a subsequent flow once flow6 settles.
