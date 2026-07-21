# PinchTab recording spike

This is the first browser-automation spike for the YMax recording harness. It
uses a dedicated, headed PinchTab profile to drive the user-facing
`https://main0.ymax.app` flow while the local MCP server remains the separate,
delegated transaction actor.

The spike deliberately stops before a signature or any portfolio-changing
action. An operator must inspect the headed browser and approve every wallet
signature. It is therefore safe to use for validating browser launch,
navigation, accessibility snapshots, and video capture without spending funds.

## Prerequisites

- PinchTab and Chromium installed on the operator's local machine. Google
  Chrome 144 ignores `--load-extension` and `--disable-extensions-except`, so
  it does not load MetaMask for this harness even when PinchTab passes the
  right flags. The local working binary was
  `/home/connolly/.nix-profile/bin/chromium`.
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

Create a `ymax-flow1` profile through the PinchTab dashboard or API and load a
low-balance, dedicated wallet into it manually. This profile represents the
user side of the recording. The MCP server's delegate key remains separate and
must not be installed in the browser profile.

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

## Next boundary

Once the smoke has been observed in a local headed browser, the next increment
is an operator-supervised Flow 1 recording: the browser actor creates the
portfolio and the MCP actor performs only the delegated action it has been
granted. The browser automation must pause before every wallet signature and
must record the post-run withdrawal/reconciliation result. This repository
does not yet automate that real-funds step.
