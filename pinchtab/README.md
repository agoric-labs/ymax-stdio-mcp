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
remains the human-controlled owner signer.

Automation must stop before every wallet signature until that boundary is
implemented and explicitly reviewed. The non-signing smoke and Flow 2 script
currently enforce that rule.

## Status

| Flow | Script | Current boundary |
|---|---|---|
| Browser/recording smoke | [`smoke.ts`](./smoke.ts) | Navigates, snapshots, and records without interaction |
| 2. Add agent to existing portfolio | [`flow2.ts`](./flow2.ts) | Local agent creates a `/grant` proposal; browser stops before `Grant delegation` |
| 1, 3–7 | — | Not implemented |

## Prerequisites

- PinchTab and Chromium installed on the operator's local machine. Google
  Chrome 144 ignores `--load-extension` and `--disable-extensions-except`, so
  it does not load MetaMask for this harness even when PinchTab passes the
  right flags. The local working binary was
  `/home/connolly/.nix-profile/bin/chromium`.
- Claude Code authenticated for the local user. Flow 2 uses the Claude Agent
  SDK and persists its native session for inspection with tools such as
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

## Remaining boundary

The next Flow 2 increment is operator-supervised MetaMask handling, invitation
redemption, and post-run reconciliation. Later scripts should retain the same
separation: the browser profile owns the portfolio, the local MCP process owns
only its delegate key, and every owner signature is an explicit checkpoint.
