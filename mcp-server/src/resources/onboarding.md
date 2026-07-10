# YMax Agent Onboarding

YDS (YMax Data Service) is the read API for portfolio and instrument data. Base URL: `https://main0.ymax.app`. Discover endpoints via `GET /openapi.json`. The MCP server handles only signed operations — all data queries go to YDS.

## Role Boundaries

- You call `generate_delegate_key` — the MCP server creates the key, funds the address, and provisions the smart wallet. Never ask the user to generate a key or provision a wallet.
- You propose the allocation. The user approves by creating the portfolio with your pre-filled link.
- You never create the portfolio yourself — only the user can do that on `main0.ymax.app`.
- You propose the delegate grant. The user approves by completing the Grant flow in the YMax UI. You do not have access to the Grant UI.
- Never ask the user for their mnemonic or private key.

## Delegation Model

- A Grant alone does not make the delegate operational. The `portfolioMandate` invitation must be redeemed.
- Delegation is portfolio-specific. Each portfolio requires its own Grant and redemption.
- The on-chain capability links a specific delegate address to a specific portfolio.
- Redeeming saves a wallet-store key as `delegate-portfolio{NN}`. The MCP server tracks this for you.

## Run Order

1. **Research & propose allocation** — Query YDS instruments, research protocols, discuss risk profile with user, then propose an initial allocation.
2. **Create delegate wallet** — Call `generate_delegate_key`. This generates the key, funds the address from the sponsor, and provisions the smart wallet in one step.
3. **Propose via create-portfolio link** — Construct the URL with your proposed allocation as query params.
   Currently operational (branch preview):
   ```
   https://feat-ago-611-prepopulated-li.ymax0-ui.pages.dev/create-portfolio?{InstrumentKey}={Pct}&...
   ```
   Example: `https://feat-ago-611-prepopulated-li.ymax0-ui.pages.dev/create-portfolio?Aave_Arbitrum=60&Compound_Arbitrum=40`
   Planned (once available, use this instead):
   ```
   https://main0.ymax.app/create-portfolio?{InstrumentKey}={Pct}&...
   ```
   The user sees the allocation pre-populated and creates the portfolio to approve it.
4. **User shares the portfolio ID** — The YMax Activity tab shows something like "Activity ID 84-1" — the portfolio is `portfolio84`. Ask the user to share the portfolio number.
5. **Propose delegation via Grant link** — First confirm the smart wallet was provisioned. Then construct the URL with the delegate address.
   Currently operational (branch preview):
   ```
   https://feat-ago-611-prepopulated-li.ymax0-ui.pages.dev/grant?accountHolder={delegateAddress}
   ```
   Example: `https://feat-ago-611-prepopulated-li.ymax0-ui.pages.dev/grant?accountHolder=agoric1rfdl83r4rmnly6jwa9mywuaj9kqc6wcw3h9wva`
   Planned (once available, use this instead):
   ```
   https://main0.ymax.app/grant?accountHolder={delegateAddress}
   ```
   The user follows the link and completes the Grant flow to approve the delegation.
6. **Redeem invitation** — Call `redeem_invitation` with the portfolio ID. The server polls for the `portfolioMandate` invitation, redeems it, and returns the agent ID and permissions.
7. **Verify** — Check the `redeem_invitation` response includes `"permissions": { "allocation": true }` and an `agentId`. This confirms the delegate is operational.

## Conventions

| Thing | Pattern | Example |
|---|---|---|
| Portfolio name | `portfolio{NN}` | `portfolio84` |
| Wallet-store key | `delegate-portfolio{NN}` | `delegate-portfolio84` |
| Activity ID mapping | `{NN}-1` → `portfolio{NN}` | `84-1` → `portfolio84` |
| Grant URL (preview) | `feat-ago-611-prepopulated-li.ymax0-ui.pages.dev/grant?accountHolder={A}` | `grant?accountHolder=agoric1...` |
| Create-portfolio URL (preview) | `feat-ago-611-prepopulated-li.ymax0-ui.pages.dev/create-portfolio?{K1}={P1}&{K2}={P2}` | `create-portfolio?Aave_Arbitrum=60&Compound_Arbitrum=40` |
| Planned production URLs | Replace `feat-ago-611-prepopulated-li.ymax0-ui.pages.dev` with `main0.ymax.app` | |
| Chain | `agoric-3` | |
| Network | `mainnet` (Agoric) | |
| Contract | `ymax0` | |
| YDS base | `https://main0.ymax.app` | |

## Failure Triage

| Symptom | Likely Cause | Remediation |
|---|---|---|
| Invitation not arriving after Grant | Grant may have been completed before provisioning, creating revoked `agent1` | Ask user to retry the Grant flow. The new invitation will appear as `agent2`. |
| Redemption fails | Mnemonic isn't the one that was funded/provisioned | The MCP server manages the mnemonic — regenerate and re-provision if this happens. |
| Wallet not funded | Sponsor balance insufficient or RPC unreachable | Fund the sponsor wallet or check `RPC_URL`. |
| `agent1` is revoked | Grant happened before smart wallet provisioning | This is expected if the first Grant preceded keygen. Retry Grant — the UI creates a new `agent2` entry. |

## Completion Report

When onboarding finishes, summarize:

- Chosen instruments and their allocations
- Portfolio ID (e.g., `portfolio84`)
- Delegate address (e.g., `agoric1...`)
- Delegation key saved (e.g., `delegate-portfolio84`)
- Agent ID and permissions (e.g., `agent2`, `{ allocation: true }`)
- Status (active/operational)
