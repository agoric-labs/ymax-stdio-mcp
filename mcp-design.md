# MCP Design: YMax Yield Agent

## Overview

This document defines an MCP (Model Context Protocol) server for a delegated YMax allocation agent on Agoric mainnet. The server wraps portfolio-management operations — key generation, smart-wallet provisioning, invitation redemption, and target-allocation submission — as MCP tools that an LLM client can invoke. See [Code Organization](#code-organization) for the proposed source layout.

**Design basis:** Four experience reports documenting the live onboarding and operation of `portfolio84` on `ymax0`:

- [Onboarding](./ymax-agent-onboarding-experience-report.md) — wallet creation, funding, provisioning, redemption
- [Target allocation](./experience-report-target-allocation.md) — first delegated `setTargetAllocation` flow
- [Mandate enforcement](./experience-report-mandate-enforcement.md) — contract rejection of out-of-scope keys
- [Iterative allocation tweaks](./experience-report-iterative-allocation-tweaks.md) — yield optimization with solver constraint discovery

### Core principle: read side is YDS

The client (LLM) reads portfolio state, instrument APYs, flow status, and delegation data directly from [YDS (YMax Data Service)](https://main0.ymax.app/openapi.json). The MCP server builds UI proposals and performs operations that require its signing key.

### Mnemonic isolation

The mnemonic is generated inside the MCP server and **never exposed to the client**. The MCP serves one local user and keeps one delegate session in private persisted state.

---

## Security Model

| Concern | Control |
|---|---|
| Mnemonic storage | Generated internally; never returned to client |
| Process boundary | The local MCP process owns the single delegate session |
| Filesystem | State file is gitignored and written with mode `0600` |
| Delegate scope | `{ allocation: true }`; authority follows the portfolio's current instrument key set |
| Sponsor wallet | Configured at startup via env; funds delegates automatically |
| Transaction signing | Delegation key held in MCP memory; no external signer |

---

## Tools

### 1. `generate_delegate_key`

Creates a new delegate key pair, funds the address from the MCP's sponsor BLD wallet, and provisions the smart wallet. The delegate is fully ready for a grant.

**Request:**
```
No arguments
```

**Response:**
```
{
  "address": "agoric1rfdl83r4rmnly6jwa9mywuaj9kqc6wcw3h9wva"
}
```

**Implementation notes:**
- Runs `agoric-keygen.ts` from `agoric-sdk/packages/portfolio-deploy/scripts/`
- Stores the generated mnemonic in MCP server state (not on disk as a shareable file)
- Sends ~20 BLD from the sponsor wallet to the new delegate address
- Provisions the smart wallet via `MsgProvision` (see [onboarding report §Funding And The Provisioning Hiccup](./ymax-agent-onboarding-experience-report.md#funding-and-the-provisioning-hiccup))
- Provisioning **must** happen before the grant is requested ([onboarding report §What I Would Do Differently Next Time](./ymax-agent-onboarding-experience-report.md#what-i-would-do-differently-next-time))
- Returns address the user gives to the YMax grant UI

**Errors:**
- Sponsor wallet insufficient balance → `"insufficient sponsor BLD"`
- Chain RPC unreachable → `"chain not available"`

---

### 2. `propose_create`

Builds a `/create-portfolio` link containing the proposed allocations, delegate address, and allocation permission. The user creates, funds, and delegates in one UI flow. Allocation keys and values are forwarded without range, total, or instrument validation so agents can exercise UI boundary behavior.

---

### 3. `redeem_invitation`

Polls for the delivered `portfolioMandate` invitation and redeems it, saving the delegation key under `delegate-portfolio{NN}`. The portfolio ID, agent ID, and permissions come from the invitation's custom details.

**Request:**
```
No arguments
```

**Response:**
```
{
  "status": "redeemed",
  "delegationKey": "delegate-portfolio84",
  "redeemTx": "C517C7D2BA8D17D80FCBE47262E0B33E0F6B5DA018C14B5C96664237F130AA5B",
  "agentId": "agent2",
  "permissions": { "allocation": true }
}
```

**Implementation notes:**
- Polls the smart wallet for an invitation with `description: "portfolioMandate"`
- Reads `{ portfolioId, agentId, permissions }` from the invitation
- Redeems using the stored mnemonic via `wallet-store.ts` `executeOffer` pattern (see [onboarding report §Grant Retry And Redemption](./ymax-agent-onboarding-experience-report.md#grant-retry-and-redemption))
- Saves result as `delegate-portfolio{NN}` with `overwrite: true`
- Saves `{ portfolioId, delegationKeyName }` in MCP server state
- The `delegate-portfolio{NN}` naming convention is required by `delegated-set-target-allocation.ts` ([skill reference](./agoric-sdk/packages/portfolio-deploy/skills/ymax-agoric-allocation-delegate/references/set-target-allocation.md))

**Errors:**
- No invitation found after timeout → `"no portfolioMandate invitation detected — has the grant been completed?"`
- Unauthorized key in grant → `"unauthorized allocations for [...]"` (see [mandate enforcement report](./experience-report-mandate-enforcement.md))

---

### 4. `propose_grant`

Builds a standalone `/grant` link for an existing portfolio. The UI delivers a mandate invitation to the provisioned delegate, and redemption derives the selected portfolio from that invitation.

---

### 5. `propose_edit`

Builds an `/edit-portfolio` link for owner approval. Instruments the owner includes in the resulting portfolio become part of its effective mandate. Like `propose_create`, it forwards allocation keys and values without policy validation.

---

### 6. `submit_target_allocation`

Submits a `setTargetAllocation` transaction signed by the stored delegation key. Automatically registers the transaction hash via `POST /transactions` to bridge the activity-page visibility gap. Uses the portfolio ID and delegation key name saved during `redeem_invitation`.

**Request:**
```
{
  "allocations": {
    "ClearstarReactor": 40,
    "HyperithmDegen": 23,
    "AlphaCore": 0,
    "GauntletRWA": 13,
    "SteakhouseHighYield": 10,
    "Compound_Base": 12,
    "Compound_Optimism": 2
  }
}
```

**Response:**
```
{
  "status": "submitted",
  "txHash": "72398D16F5214D91E58D8FCF025B9ABAF649F6CC4191562D1F9C4DB97DA2EAA0",
  "flowKey": "flow6",
  "policyVersion": 6
}
```

**Implementation notes:**
- Calls `setTargetAllocation` by importing the delegation and wallet-store helpers directly as modules — no CLI subprocess
- Passes allocations as a single `{ targetAllocation, syncState }` struct — two positional args collapse through the marshal layer and cause `"Must have missing properties"` ([target allocation report Finding #2](./experience-report-target-allocation.md#2-settargetallocation-args-collapse-through-the-marshal-layer))
- Resolves delegation key as `delegate-portfolio{NN}` from server state
- After the on-chain tx confirms, auto-registers via `POST /transactions` with the portfolio ID and flow key
- Registration is necessary because delegated submissions do not appear on the YMax activity page ([target allocation report Finding #4](./experience-report-target-allocation.md#4-activity-page-never-reflects-delegated-submissions), [iterative tweaks report Finding #6](./experience-report-iterative-allocation-tweaks.md#6-activity-page-still-doesnt-reflect-delegated-submissions))

**Errors:**
- No prior `redeem_invitation` → `"no portfolio state — call redeem_invitation first"`
- Solver rejects → `"Nothing to do for this operation"` (deltas too small) or `"No feasible solution"` (cross-chain routing infeasible)

---

## Resources

### Resource: `solver-constraints`

Static reference documenting the multi-layer minimum transfer thresholds discovered in the iterative tweaks report. Clients use this to size allocations before calling `submit_target_allocation`.

| Threshold | Amount | File | Layer |
|---|---|---|---|
| **CCTP hard runtime floor** | **$1.00** (1,000,000 uusdc) | `pos-evm.flows.ts:191-216` | Hard `Fail` — bridge leg **must** be ≥ $1.00 |
| **Delta soft minimum** | **$1.00** (1,000,000 uusdc) | `target-balances.ts:20` | Position deltas < $1.00 suppressed before solver |
| **CCTPv2 EVM→EVM link min** | **$0.10** (100,000 uusdc) | `prod-network.ts` | LP coupling constraint |
| **CCTP-from-Noble link min** | **$1.00** (1,000,000 uusdc) | `prod-network.ts` | LP coupling constraint |
| **Account dust epsilon** | **$0.0001** (100 uusdc) | `constants.js:189-193` | Balance filtering |
| **Effective arc minimum (in practice)** | **$1.47–$2.00** | LP solver coupling | Combines link min + CCTP fee + delta soft min + arc interactions |

**Practical rules at $45 TVL** ([iterative tweaks report Finding #7](./experience-report-iterative-allocation-tweaks.md#7-minimum-transfer-amounts-multi-layer-enforcement)):
- Same-chain deltas: ≥ **$1.00** (≈ **2.2% weight**)
- Cross-chain deltas: ≥ **$2.00** (≈ **4.5% weight**) — coupling constraints often demand more
- At sub-$100 TVL, use deltas of **+5 to +15 percentage points** to avoid solver "Nothing to do"
- Residuals below $1.00 on a non-native chain are **likely stranded** unless combined with new deposits

### Resource: `provisioning-runbook`

Correct ordering derived from the onboarding report's painful lesson (grant-before-provisioning created `agent1` in revoked state):

1. `generate_delegate_key` — keygen + fund + provision (single atomic MCP tool)
2. `propose_create` — combined create-and-delegate link
3. User completes one YMax UI flow
4. `redeem_invitation` — derive binding, redeem, and save state
5. `submit_target_allocation` — allocate (repeat as needed)

---

## Operator Prerequisites

The MCP server imports from `@agoric/client-utils` and `@aglocal/portfolio-contract`, which the agoric-sdk provides. The operator must build the SDK once via `nix develop` so its packages are available as dependencies. At runtime the server is a plain Node.js process — no nix involved. See [iterative tweaks report Finding #4](./experience-report-iterative-allocation-tweaks.md#4-nix-develop-is-required-for-the-toolchain) for the original CLI pattern that this design replaces.

---

## Code Organization

```
mcp-server/
  src/
    server.ts            # MCP entrypoint: tool registration, request dispatch
    handlers/
      generate-key.ts    # generate_delegate_key — tool def, input schema, impl
      propose.ts         # create, grant, and edit proposal UI links
      redeem.ts          # redeem_invitation — tool def, input schema, impl
      submit-allocation.ts  # submit_target_allocation — tool def, input schema, impl
    proposals.ts         # Pure proposal URL builders
    invitation.ts        # Invitation detail extraction
    state.ts             # Single-user persisted delegate state
    sponsor.ts           # Sponsor wallet: key management, balance check, BLD transfer
    provision.ts         # Smart-wallet MsgProvision logic
    registration.ts      # POST /transactions activity-page bridge
    types.ts             # Shared types and interfaces
  package.json
  tsconfig.json
```

Each handler file defines its own `description` and `inputSchema` in the MCP tool registration — the spec lives in code, not in a separate doc. This `mcp-design.md` captures the rationale and design decisions that don't belong in the tool schemas.

The server depends on packages from the agoric-sdk worktree for:
- `@agoric/client-utils` — wallet-store proxy, bridge message serialization
- `@aglocal/portfolio-contract` — delegation helpers, offer shapes
- `@agoric/cosmic-proto` — `MsgProvision` protobuf encoding

## Design Decisions

| Decision | Rationale | Source |
|---|---|---|
| Mnemonic stays in MCP | Never expose the signing key to the LLM context | Onboarding report: "never paste mnemonic into chat" |
| Single local session | Keeps key material behind the MCP process boundary | Local single-user deployment |
| Single-struct args for `setTargetAllocation` | Two positional args collapse through marshal layer | Target allocation report Finding #2 |
| Auto-derive `delegate-portfolio{NN}` | Convention required by `delegated-set-target-allocation.ts` | Both skill docs, all three delegation reports |
| Derive portfolio ID from invitation | Avoids user input and binds the saved capability to its actual portfolio | `portfolioMandate` custom details |
| Agent address vs delegate address | The agent address is derived from the mnemonic; the delegate address receives the grant | Delegate address is used for the grant link |
| Poll for invitation after grant | The invitation may not be available immediately after provisioning | Onboarding report: user retried grant after provisioning |
| `overwrite: true` on redeem | A first attempt may create a stale `agent1` in revoked state | Onboarding report: first grant before provisioning |
| No query tools | YDS handles reads; MCP is action-only | Per requirement |
| Proposal values forwarded as-is | Lets agents exercise UI boundary behavior | Per requirement |
| Sponsor wallet funded at MCP startup | Eliminates manual BLD funding step from onboarding | Onboarding report: "fund the delegate address" was a manual hiccup |
| Auto-register transactions | Activity page ignores delegated submissions | Target allocation report Finding #4, iterative tweaks report Finding #6 |

---

## Error Reference

| Error | Likely Cause | Remediation |
|---|---|---|
| `"Nothing to do for this operation"` | Deltas below soft minimum or snapshot unavailable | Increase allocation deltas above $1.00 (same-chain) or $2.00 (cross-chain) |
| `"No feasible solution"` | LP solver cannot find valid routing through arc coupling constraints | Reduce cross-chain delta magnitude or simplify the routing pattern |
| `"unauthorized allocations for [...]"` | Instrument key not in portfolio's allowed set | Remove unrecognized keys from allocation (query via YDS to get current key set) |
| `"Must have missing properties"` | Two positional args instead of single struct | Ensure MCP sends `{ targetAllocation, syncState }` |
| `"too small to relay"` | CCTP bridge leg < $1.00 | Increase the cross-chain allocation; combine with other funds |
| `"insufficient sponsor BLD"` | Sponsor wallet balance depleted | Fund the sponsor wallet |
| `"no portfolioMandate invitation detected"` | Grant not yet completed, or polling timeout | Verify user completed the grant via YMax UI for the correct portfolio |
| `"no delegate state"` | Delegate wallet has not been generated | Call `generate_delegate_key` |
