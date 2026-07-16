# YMax Agent Onboarding

YDS is the read API for portfolio and instrument data. Base URL: `https://main0.ymax.app`. The MCP server keeps signing material and signed operations local.

## Role Boundaries

- Call `generate_delegate_key`; the server creates, funds, and provisions the delegate wallet.
- Never ask the user for a mnemonic or private key.
- Propose allocations through UI links. The user approves portfolio creation, funding, delegation, and owner edits in YMax.
- Use `submit_target_allocation` only after the delegation invitation has been redeemed.

## Delegation Model

- Provisioning must happen before delegation.
- `propose_create` combines allocation prefill and the delegate address so creation and delegation take one trip through the UI.
- The delivered `portfolioMandate` invitation contains `portfolioId`, `agentId`, and `permissions`; `redeem_invitation` derives the binding from those details.
- Delegated allocation authority applies to the portfolio's current instrument key set. When the owner includes instruments in an approved edit, they become part of the effective mandate.
- Redeeming saves the capability as `delegate-portfolio{NN}`.

## Run Order

1. Query YDS, discuss risk, and propose an initial allocation.
2. Call `generate_delegate_key`.
3. Call `propose_create` with the proposed allocation map.
4. Give the returned link to the user. They create, fund, and delegate in one UI flow.
5. Call `redeem_invitation`; do not ask the user for a portfolio number.
6. Verify that the response contains the expected portfolio, agent, and `{ "allocation": true }` permission.
7. Use `submit_target_allocation` for autonomous changes.
8. Use `propose_edit` when the user should approve an allocation or instrument-set change.

Proposal tools intentionally forward allocation keys and numeric values without enforcing instrument membership, totals, or ranges. This lets agents exercise and observe UI boundary handling. The UI remains responsible for interpreting the proposal before the user approves it.

## URL Shape

Combined creation:

```text
{YMAX_UI_URL}/create-portfolio?{InstrumentKey}={Value}&...&accountHolder={delegateAddress}&permissions=change-allocations
```

Owner-approved edit:

```text
{YMAX_UI_URL}/edit-portfolio?{InstrumentKey}={Value}&...
```

The default UI is the `Agoric/ymax-web#840` branch preview. Configure `YMAX_UI_URL` when targeting another deployment.

## Failure Triage

| Symptom | Likely cause | Remediation |
|---|---|---|
| No delegate state | Key generation has not completed | Call `generate_delegate_key` |
| Invitation not arriving | UI flow is incomplete or ran before provisioning | Complete or retry the combined UI flow |
| Invalid invitation details | The delivered invitation is not the expected contract version | Inspect its `customDetails` and deployment versions |
| Wallet not funded | Sponsor balance is insufficient or RPC is unavailable | Fund the sponsor or check `RPC_URL` |
| Delegated allocation rejects an instrument set | Proposal keys differ from the portfolio's current keys | Re-read the portfolio or ask the owner to approve an edit |

## Completion Report

Report the chosen allocation, portfolio ID, delegate address, saved delegation key, agent ID, permissions, and operational status.
