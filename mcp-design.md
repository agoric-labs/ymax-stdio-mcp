# MCP Design: YMax Yield Agent

## Overview

This document defines an MCP (Model Context Protocol) server for a delegated YMax allocation agent on Agoric mainnet. The server wraps portfolio-management operations — key generation, smart-wallet provisioning, invitation redemption, and target-allocation submission — as MCP tools that an LLM client can invoke. See [Code Organization](#code-organization) for the proposed source layout.

**Design basis:** Four experience reports documenting the live onboarding and operation of `portfolio84` on `ymax0`:

- [Onboarding](./ymax-agent-onboarding-experience-report.md) — wallet creation, funding, provisioning, redemption
- [Target allocation](./experience-report-target-allocation.md) — first delegated `setTargetAllocation` flow
- [Mandate enforcement](./experience-report-mandate-enforcement.md) — contract rejection of out-of-scope keys
- [Iterative allocation tweaks](./experience-report-iterative-allocation-tweaks.md) — yield optimization with solver constraint discovery

### Core principle: read side is YDS

The client (LLM) reads portfolio state, instrument APYs, flow status, and delegation data directly from [YDS (YMax Data Service)](https://main0.ymax.app/openapi.json). The MCP server handles only **write/action operations** that require a signing key.

### Mnemonic isolation

The mnemonic is generated inside the MCP server and **never exposed to the client**. The client authenticates subsequent calls with a bearer token returned at key-generation time. The MCP may serve a single user.

### Bearer token rotation

Tokens can be rotated at any time via `rotate_token`. The old token is immediately invalidated; all server state (mnemonic, portfolio bindings, delegation keys) is preserved under the new token.

---

## Security Model

| Concern | Control |
|---|---|
| Mnemonic storage | Generated internally; never returned to client |
| Auth | Bearer token returned by `generate_delegate_key`; required on all subsequent calls |
| Token rotation | `rotate_token` invalidates old token, issues new one; state preserved |
| Filesystem | `.secrets/` directory gitignored, `chmod 600` |
| Delegate scope | `{ allocation: true }` only — cannot create positions, deposit, withdraw, or add new instruments |
| Sponsor wallet | Configured at startup via env; funds delegates automatically |
| Transaction signing | Delegation key held in MCP memory; no external signer |

---

## Tools

### 1. `generate_delegate_key`

Creates a new delegate key pair, funds the address from the MCP's sponsor BLD wallet, and provisions the smart wallet. The delegate is fully ready for a grant — the user receives the address and a bearer token for subsequent calls.

**Request:**
```
No arguments (auth not yet established)
```

**Response:**
```
{
  "address": "agoric1rfdl83r4rmnly6jwa9mywuaj9kqc6wcw3h9wva",
  "bearerToken": "tok_..."
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

### 2. `redeem_invitation`

Polls for the delivered `portfolioMandate` invitation (after the user completes the grant via YMax UI) and redeems it, saving the delegation key in the wallet store under the conventional name `delegate-portfolio{NN}`. Saves the portfolio ID and delegation key name in MCP server state so subsequent calls don't need them.

**Request:**
```
{
  "bearerToken": "tok_...",
  "portfolioId": 84
}
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
- Polls the smart wallet's vstorage for an invitation with `description: "portfolioMandate"` for the given `portfolioId`
- Redeems using the stored mnemonic via `wallet-store.ts` `executeOffer` pattern (see [onboarding report §Grant Retry And Redemption](./ymax-agent-onboarding-experience-report.md#grant-retry-and-redemption))
- Saves result as `delegate-portfolio{NN}` with `overwrite: true`
- Saves `{ portfolioId, delegationKeyName }` in MCP server state under the bearer token
- The `delegate-portfolio{NN}` naming convention is required by `delegated-set-target-allocation.ts` ([skill reference](./agoric-sdk/packages/portfolio-deploy/skills/ymax-agoric-allocation-delegate/references/set-target-allocation.md))

**Errors:**
- No invitation found after timeout → `"no portfolioMandate invitation detected — has the grant been completed?"`
- Unauthorized key in grant → `"unauthorized allocations for [...]"` (see [mandate enforcement report](./experience-report-mandate-enforcement.md))

---

### 3. `submit_target_allocation`

Submits a `setTargetAllocation` transaction signed by the stored delegation key. Automatically registers the transaction hash via `POST /transactions` to bridge the activity-page visibility gap. Uses the portfolio ID and delegation key name saved during `redeem_invitation`.

**Request:**
```
{
  "bearerToken": "tok_...",
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
- Bearer token unknown → `"unauthorized"`
- No prior `redeem_invitation` for this token → `"no portfolio state — call redeem_invitation first"`
- Solver rejects → `"Nothing to do for this operation"` (deltas too small) or `"No feasible solution"` (cross-chain routing infeasible)

---

### 4. `rotate_token`

Invalidates the current bearer token and issues a new one. All server state (mnemonic, portfolio bindings, delegation key references) is preserved under the new token — on-chain state is unaffected. Use when the current token is compromised or as a routine precaution.

**Request:**
```
{
  "bearerToken": "tok_..."
}
```

**Response:**
```
{
  "newBearerToken": "tok_..."
}
```

**Implementation notes:**
- Generates a new bearer token and associates it with the existing server state
- The old token is immediately removed from the valid-token index
- No chain interaction — the mnemonic and delegation key on-chain are unchanged
- Any in-flight operations using the old token will fail with `"unauthorized"` on subsequent status checks

**Errors:**
- Bearer token unknown → `"unauthorized"`

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
2. User completes YMax grant via UI using the returned address
3. `redeem_invitation` — poll + redeem + save state
4. `submit_target_allocation` — allocate (repeat as needed)

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
      redeem.ts          # redeem_invitation — tool def, input schema, impl
      submit-allocation.ts  # submit_target_allocation — tool def, input schema, impl
      rotate-token.ts    # rotate_token — tool def, input schema, impl
    state.ts             # In-memory session store (bearer token → { mnemonic, portfolioId, delegationKeyName })
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
| Bearer token auth | Links operations to a session without exposing key material | Onboarding report security practices |
| Single-struct args for `setTargetAllocation` | Two positional args collapse through marshal layer | Target allocation report Finding #2 |
| Auto-derive `delegate-portfolio{NN}` | Convention required by `delegated-set-target-allocation.ts` | Both skill docs, all three delegation reports |
| Agent address vs delegate address | The agent address is derived from the mnemonic; the delegate address receives the grant | Delegate address is used for the grant link |
| Poll for invitation after grant | The invitation may not be available immediately after provisioning | Onboarding report: user retried grant after provisioning |
| `overwrite: true` on redeem | A first attempt may create a stale `agent1` in revoked state | Onboarding report: first grant before provisioning |
| No query tools | YDS handles reads; MCP is action-only | Per requirement |
| No validation tool | Client applies constraint knowledge from resources | Per requirement |
| Sponsor wallet funded at MCP startup | Eliminates manual BLD funding step from onboarding | Onboarding report: "fund the delegate address" was a manual hiccup |
| Auto-register transactions | Activity page ignores delegated submissions | Target allocation report Finding #4, iterative tweaks report Finding #6 |
| Bearer token rotation | Limit blast radius of a leaked token without changing on-chain keys | Security best practice |

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
| `"unauthorized"` | Bearer token invalid or rotated | Re-authenticate via `generate_delegate_key` or use a newly rotated token |
