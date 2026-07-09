# YMax Agent Onboarding Experience Report

## Scope

This report is scoped to onboarding the YMax allocation delegate, including the initial allocation discussion, portfolio creation handoff, delegate wallet creation, delegate BLD funding, smart-wallet provisioning, grant retry, and invitation redemption.

It does not cover ongoing portfolio management after onboarding, except to note that the final saved delegation can now be used for future allocation-only updates.

## Original Request

The user asked:

> as a defy agent please help me maximize my yield cross chain. use this https://github.com/Agoric/agoric-sdk/tree/dc-agent-skill/packages/portfolio-deploy/skills

The intent was to act as a delegated DeFi allocation agent for a cross-chain YMax portfolio, using the Agoric SDK branch skill instructions rather than inventing an unrelated workflow.

## Ultimate Onboarding Result

We completed onboarding for an allocation-only delegate for YMax `ymax0` on Agoric mainnet, including funding the delegate address and provisioning its smart wallet.

- Portfolio: `portfolio84`
- Delegate address: `agoric1rfdl83r4rmnly6jwa9mywuaj9kqc6wcw3h9wva`
- Delegate funding received: `20 BLD`
- Smart-wallet provision tx: `2EBEFAF728D6402700DBC8E938960E6F00375E240580432D9CF854B6C9B00432`
- Delegation redeem tx: `C517C7D2BA8D17D80FCBE47262E0B33E0F6B5DA018C14B5C96664237F130AA5B`
- Saved delegation key: `delegate-portfolio84`
- Verified YMax agent state: `agent2` active with `{ allocation: true }`
- Delegate BLD balance after provisioning and redemption: `19.895 BLD`

The agent is now operational for allocation-only delegated updates. It cannot create the portfolio, withdraw funds, deposit funds, or add new instruments outside the current portfolio authority. Its narrow mandate is the YMax `setTargetAllocation` flow.

## How We Got There

First, I fetched and read the Agoric skill package from the `dc-agent-skill` branch. The relevant skills were:

- `ymax-agoric-onboarding`
- `ymax-agoric-allocation-delegate`

Those instructions made the boundaries clear:

- Scope to mainnet and `ymax0`.
- Do not ask for the user's private key or mnemonic.
- Do not create the portfolio for the user.
- Create a delegate wallet for the agent.
- Provision the delegate smart wallet before grant/redeem.
- After delegation, operate only through the saved allocation delegation.
- Preserve the current instrument key set when updating allocations.

I also read the local OCap/POLA guide from `~/repo/awesome-ocap/style-guide/ocap-py-style-guide.md`. The practical theme was to keep authority explicit: do not hide filesystem, network, signing, or chain powers in helper logic. That shaped the local scripts: the mnemonic is stored in `.secrets/`, ignored by git, and the transaction helpers perform very narrow chain actions.

## Initial Allocation Work

I queried current YMax public data from:

- `https://main0.ymax.app/openapi.json`
- `https://main0.ymax.app/instruments`
- selected 30-day instrument history endpoints

The initial yield-seeking allocation was saved as:

`allocations-ymax-initial-yield-seeking.json`

It allocated across Morpho and Compound instruments with a small capped weight to `Compound_Optimism`, because the current APY was high but liquidity and recent history looked spikier. The computed current weighted APY was about `7.57%`, with a 30-day daily average around `6.56%`.

The user asked to use the branch-preview URL, so the create-portfolio link used:

`https://feat-ago-611-prepopulated-li.ymax0-ui.pages.dev/create-portfolio?...`

The user later provided `Activity ID 84-1`, which mapped to `portfolio84`.

## Delegate Wallet Creation

The Agoric branch contained:

`packages/portfolio-deploy/scripts/agoric-keygen.ts`

I initially drifted toward recreating the keygen dependencies, and the user correctly challenged that. I then ran the Agoric SDK source script itself and saved the generated agent config locally at:

`.secrets/ymax-agent-portfolio84.env`

The file is git-ignored and chmodded `600`. The mnemonic was never pasted into chat.

The generated delegate address was:

`agoric1rfdl83r4rmnly6jwa9mywuaj9kqc6wcw3h9wva`

## Durable Delegate Key Location

The delegate key is saved for future sessions in this workspace at:

`/Users/connolly/Documents/yield1/.secrets/ymax-agent-portfolio84.env`

That file contains the agent's `AGENT_ADDRESS` and `MNEMONIC` exports. It is intentionally not committed:

- `.secrets/` is listed in `.gitignore`.
- The file permissions are `600` (`-rw-------`), owned by `connolly`.
- Future sessions in this same workspace can source or read this file to derive the same delegate address and use the saved on-chain delegation key `delegate-portfolio84`.

Do not paste the mnemonic into chat, tickets, logs, or commits.

## Funding And The Provisioning Hiccup

I gave the grant link before provisioning the smart wallet. That was a mistake.

The user used the grant link, then asked whether the smart wallet had been provisioned. I checked:

- Balance was initially `0 BLD`.
- The wallet vstorage node was empty.

The user then funded the delegate address with `20 BLD`. After that, the balance query showed:

`20,000,000 ubld`

The wallet still was not provisioned, so I wrote a narrow provisioning helper:

`provision-ymax-agent-wallet.mjs`

That helper uses:

- the saved local mnemonic
- the Agoric HD path `m/44'/564'/0'/0/0`
- the Agoric `MsgProvision` shape from the branch source
- one mainnet transaction to provision `SMART_WALLET`

The first attempt to use the generated TypeScript codec directly failed locally because the sparse SDK checkout was not a built workspace and `ts-blank-space` could not execute a generated TypeScript `enum`. The transaction did not reach the network. I then patched the helper to use a minimal protobuf encoder for the exact `MsgProvision` fields from `msgs.proto`.

After explicit approval, the provisioning transaction succeeded:

`2EBEFAF728D6402700DBC8E938960E6F00375E240580432D9CF854B6C9B00432`

The smart wallet vstorage node then appeared, confirming provisioning.

## Grant Retry And Redemption

Because the first grant happened before provisioning, it produced `agent1` in a revoked state. The user retried the branch-preview grant after provisioning.

The wallet then showed a delivered invitation:

- Description: `portfolioMandate`
- Portfolio id: `84`
- Agent id: `agent2`
- Permissions: `{ allocation: true }`

The ideal path would have been to run the existing SDK command:

```sh
./packages/portfolio-deploy/scripts/wallet-admin.ts \
  ./packages/portfolio-deploy/src/redeem-invitation.ts \
  --contract ymax0 \
  --description portfolioMandate \
  --save-as delegate-portfolio84
```

In this sparse checkout, that path was not operational because the SDK workspace was not installed/built, and the generated TypeScript runtime path was already failing locally. Rather than install/build the entire SDK in the middle of a live mainnet session, I wrote a narrow redeem helper:

`redeem-ymax-agent-invitation.mjs`

It uses the same offer shape from `redeem-invitation.ts` and `wallet-store.ts`:

- `method: executeOffer`
- `invitationSpec.source: purse`
- `description: portfolioMandate`
- `saveResult.name: delegate-portfolio84`
- `saveResult.overwrite: true`

That redemption succeeded:

`C517C7D2BA8D17D80FCBE47262E0B33E0F6B5DA018C14B5C96664237F130AA5B`

Vstorage then confirmed the result was saved as:

`delegate-portfolio84`

The portfolio agents path showed:

- `agent1`: revoked
- `agent2`: active
- `agent2.grantee`: `agoric1rfdl83r4rmnly6jwa9mywuaj9kqc6wcw3h9wva`
- `agent2.permissions.allocation`: `true`

## Struggles Overcome

The biggest operational struggle was the difference between "source is checked out" and "the Agoric SDK toolchain is runnable." The branch skill instructions point to source scripts, but a sparse checkout does not automatically provide a built workspace, linked packages, or `agd`.

Specific issues:

- The first GitHub fetch needed escalation because network access was restricted.
- The `agoric` and `agd` commands were not installed on PATH.
- The sparse checkout lacked workspace dependencies.
- The existing source script path imported generated TypeScript that was not directly executable in this environment.
- The grant was attempted before smart-wallet provisioning, which created a revoked first agent.
- The YMax UI activity id needed translation from `84-1` to `portfolio84`.

The path through was:

- Use the branch source for semantics and offer shapes.
- Use public YDS and Agoric vstorage for verification.
- Keep secrets local and ignored.
- Write one-purpose helpers for exactly the missing transaction boundaries.
- Ask for explicit approval before broadcasting real mainnet transactions.
- Verify each chain action by tx result and vstorage state.

## What I Would Do Differently Next Time

Provision first, grant second.

A cleaner runbook would be:

1. Fetch the Agoric skill branch.
2. Generate the delegate key using `agoric-keygen.ts`.
3. Fund the delegate address.
4. Provision the smart wallet.
5. Confirm wallet vstorage is published.
6. Give the user the grant link.
7. Poll for `portfolioMandate`.
8. Redeem and save as `delegate-portfolioNN`.
9. Verify `portfolioNN.agents`.
10. Only then prepare or submit allocation updates.

If there is time before the live workflow, build a proper Agoric SDK checkout so `wallet-admin.ts` and `redeem-invitation.ts` can run directly. The one-off helpers worked, but the existing scripts are the better long-term path when the SDK workspace is fully installed.
