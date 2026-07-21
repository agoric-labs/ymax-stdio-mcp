# YMax seven-flow recording harness

This directory contains the on-demand recording harness for the seven YMax
agent flows requested in
https://github.com/kriskowal/garden/issues/57:

1. Create mandate through chat for a new portfolio.
2. Add agent through chat for an existing portfolio.
3. Change mandate with agent.
4. Agent takes live action within mandate.
5. Show out-of-mandate enforcement and rejection.
6. Show async agent action within mandate.
7. Show activity screen agent/user attribution.

These are production-adjacent demonstrations against YMax on Agoric mainnet,
not a per-change regression suite. PinchTab drives a dedicated headed browser;
a local Claude session uses this repository's stdio MCP server; and MetaMask
in a dedicated profile remains the owner signer.

Flow 1 drives wallet connection, the configured deposit, and MetaMask
approvals, then resumes its persisted local-agent session to redeem the
invitation. The non-signing smoke and Flow 2 script stop before any wallet
signature.

## Status

| Flow | Script | Current boundary |
|---|---|---|
| Browser/recording smoke | [`smoke.ts`](./smoke.ts) | Navigates, snapshots, and records without interaction |
| 1. Create a new portfolio | [`flow1.ts`](./flow1.ts) | Complete automated creation, funding, delegation, and invitation redemption |
| 2. Add agent to existing portfolio | [`flow2.ts`](./flow2.ts) | Local agent creates a `/grant` proposal; browser stops before `Grant delegation` |
| 3–7 | — | Not implemented |

## Prerequisites

- PinchTab and Chromium installed on the operator's local machine. Google
  Chrome 144 ignores `--load-extension` and `--disable-extensions-except`, so
  it does not load MetaMask for this harness even when PinchTab passes the
  right flags. The local working binary was
  `/home/connolly/.nix-profile/bin/chromium`.
- Claude Code authenticated for the local user. Flows 1 and 2 use the Claude
  Agent SDK and persist native sessions for inspection with tools such as
  AgentsView.
- The MCP server dependencies installed in [`../mcp-server`](../mcp-server), a
  built [`../agoric-sdk`](../agoric-sdk) worktree, and the sponsor environment
  needed by `generate_delegate_key`.
- A PinchTab server bound to `127.0.0.1`, with its generated bearer token kept
  outside this repository.
- An unpacked wallet extension placed in the PinchTab extensions directory, or
  an existing dedicated browser profile imported into PinchTab. Never use a
  personal browsing profile.

This machine uses `~/.config/pinchtab` for PinchTab state. The tested MetaMask
unpacked extension path was
`~/.config/pinchtab/extensions/metamask-13.39.2`.
The wallet's seed phrase, the PinchTab control token, profile data, and video
artifacts are secrets or sensitive operational data. Do not commit any of them.

## Configure a dedicated profile

Copy [`config.example.json`](./config.example.json) into the local PinchTab
configuration. Replace the placeholder token locally, and set
`browser.binary` to Chromium and `browser.extensionPaths` to the unpacked
MetaMask directory. The configuration intentionally keeps all sensitive
capabilities off except `allowScreencast`, which is necessary to write a local
recording.

PinchTab's `browser.binary` and `browser.extensionPaths` settings are global in
the current build. For one-off setup, set them, restart PinchTab, start
`ymax-flow1`, verify MetaMask is present, then clear the saved global settings
so other profiles do not inherit the wallet extension on the next restart.

The optional [`ymax-recording-theme`](./ymax-recording-theme/manifest.json)
extension gives the recording profile a distinctive browser frame. Load it
alongside MetaMask when starting the YMax profile.

Create a dedicated profile through the PinchTab dashboard or API and load a
low-balance wallet into it manually. `smoke.ts` defaults to the historical
`ymax-flow1` profile name; select a flow-specific profile with
`PINCHTAB_YMAX_PROFILE`. This profile represents the owner side of a recording.
The MCP server's delegate key remains separate and must not be installed in the
browser profile.

Verify the extension load before importing or creating a wallet. In the headed
browser, open `chrome://extensions/` and confirm MetaMask is listed. A stronger
check is the Chromium DevTools target list for the instance debug port; a
working launch shows a MetaMask onboarding page, service worker, and offscreen
page under a `chrome-extension://...` URL. Seeing only `chrome://extensions/`
means the wallet did not load.

Before a real recording, have an operator check all of these conditions:

1. The profile is dedicated to this harness and is not a personal wallet.
2. The browser is headed and the only permitted navigation domains are YMax
   domains needed by the flow.
3. The funding EOA mnemonic is supplied only through an ignored local secret
   mechanism, never in an agent prompt, browser text field, log, or commit.
4. The operator has set the per-run USDC cap and has a withdrawal and
   reconciliation plan.

## Run the non-signing smoke

With the local server running, execute:

```sh
./pinchtab/smoke.ts
```

`smoke.ts` reads `server.token` from the local PinchTab config by default. Set
`PINCHTAB_TOKEN` explicitly only when using a non-standard token source.
Do not use `pinchtab config token` in command substitution; that command copies
the token to the clipboard and does not print it to stdout.

The script creates or reuses the dedicated profile, starts it headed with an
instance-scoped allowlist, opens `main0.ymax.app`, takes an interactive
snapshot, and starts and stops a short recording. It does not click, fill,
sign, or submit anything.

If `ymax-flow1` is already running, PinchTab may return HTTP 409 from the
profile start endpoint. The script treats that as "already started" and reuses
the existing instance.

PinchTab records a GIF internally because that path is reliable. By default,
`smoke.ts` converts the GIF to MP4 with local `ffmpeg` and prints the final path
only after the file exists. Set `PINCHTAB_RECORDING_FORMAT=gif` to keep only the
PinchTab GIF, or `PINCHTAB_RECORDING_FORMAT=webm` to convert the GIF to WebM.
The snapshot and navigation response live under `artifacts/`, which is ignored
by Git. Inspect the recording locally before using the profile for a real flow.

The older [`smoke.sh`](./smoke.sh) script is retained for compatibility, but the
TypeScript port is the maintained harness. It follows the same dependency
injection pattern as the Agoric scripts: `main(argv, env, io)` defaults to real
process capabilities, while tests inject `fetch`, config reads, delays, file
operations, and `ffmpeg` execution.

PinchTab advertises `gif`, `webm`, and `mp4` recording formats but rejects
`webp`. Direct PinchTab `mp4` and `webm` encoding failed on this machine because
ffmpeg could not infer a muxer from temporary filenames ending in
`.mp4.encoding.tmp` or `.webm.encoding.tmp`, so the smoke script avoids those
direct paths.

## Run automated Flow 1

Flow 1 asks the local Claude agent for a diversified initial allocation and a
combined `/create-portfolio` proposal. The script validates the proposal's UI
origin, allocation total, delegate address, and allocation permission before
opening it in the dedicated PinchTab profile.

The operator's job ends after setting up and funding MetaMask in the dedicated
profile. Set the intended deposit explicitly; the driver rejects values above
the 30 USDC recording cap. `YMAX_FLOW1_MAX_INSTRUMENTS` defaults to 3 and
limits both the agent request and accepted proposal to 1–12 instruments. This
is useful for keeping very small test deposits above per-position minimums.

The script connects MetaMask when necessary, enters the deposit, creates the
portfolio, and approves MetaMask requests only when they identify the expected
YMax host. It allows at most 12 wallet approvals. It then resumes the same
persisted Claude session, redeems the invitation, and verifies that the result
identifies a portfolio, agent, and allocation authority.

```sh
YMAX_FLOW1_DEPOSIT_USDC=3 \
YMAX_FLOW1_MAX_INSTRUMENTS=1 \
npm run pinchtab:flow1
```

Setting `YMAX_FLOW1_DEPOSIT_USDC` and running the script authorizes a real-money
workflow; there is no later operator checkpoint. The test suite exercises the
complete YMax and MetaMask orchestration with mocks:

```sh
npm run pinchtab:test
```

## Run Flow 2 to the signature boundary

Flow 2 gives a Claude Agent SDK session access to every tool on this
repository's stdio MCP server. The user-facing prompt asks Claude to prepare a
delegation link without naming implementation-level tools. The script validates
that the returned URL belongs to the configured YMax UI, opens it with PinchTab,
checks for the `New agent` page and `Grant delegation` action, and then
intentionally throws:

```text
Error: TODO: click Grant delegation and handle the first MetaMask signature
```

The script prints the Claude session ID, MCP tool calls, and assistant text as
they arrive. Claude's native session persistence remains enabled, so AgentsView
can observe and retain the complete structured session without a PTY recorder.
Browser navigation begins after Claude returns its grant URL.

Use a dedicated profile whose wallet is already connected and owns an existing
portfolio. The script rejects a page showing `Connect Wallet`; it does not open
or automate MetaMask.

```sh
PINCHTAB_YMAX_PROFILE=ymax-flow2 npm run pinchtab:flow2
```

The stdio MCP server loads `mcp-server/.env` itself; Flow 2 neither reads nor
preflights the sponsor credential. `generate_delegate_key` may fund and
provision a new delegate on mainnet, so use only the dedicated low-value sponsor
described above.

## Remaining Flow 2 boundary

The next Flow 2 increment is operator-supervised MetaMask handling, invitation
redemption, and post-run reconciliation. All flows retain the same role
separation: the browser profile owns the portfolio and the local MCP process
owns only its delegate key. Automated signing must remain origin-bound and
explicitly configured with a real-funds amount, as in Flow 1.
