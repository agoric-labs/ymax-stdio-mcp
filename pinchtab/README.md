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

- PinchTab and Chrome installed on the operator's local machine.
- A PinchTab server bound to `127.0.0.1`, with its generated bearer token kept
  outside this repository.
- An unpacked wallet extension placed in the PinchTab extensions directory, or
  an existing dedicated browser profile imported into PinchTab. Never use a
  personal browsing profile.

PinchTab loads unpacked extensions from `~/.pinchtab/extensions` by default.
The wallet's seed phrase, the PinchTab control token, profile data, and video
artifacts are secrets or sensitive operational data. Do not commit any of them.

## Configure a dedicated profile

Copy [`config.example.json`](./config.example.json) into the local PinchTab
configuration. Replace the placeholder token locally, and set
`browser.extensionPaths` to the directory containing the unpacked wallet
extension. The configuration intentionally keeps all sensitive capabilities
off except `allowScreencast`, which is necessary to write a local recording.

Create a `ymax-flow1` profile through the PinchTab dashboard or API and load a
low-balance, dedicated wallet into it manually. This profile represents the
user side of the recording. The MCP server's delegate key remains separate and
must not be installed in the browser profile.

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
PINCHTAB_TOKEN="$(pinchtab config token)" \
  ./pinchtab/smoke.sh
```

The script creates or reuses the dedicated profile, starts it headed with an
instance-scoped allowlist, opens `main0.ymax.app`, takes an interactive
snapshot, and starts and stops a short MP4 recording. It does not click,
fill, sign, or submit anything.

PinchTab writes the resulting MP4 to its local recordings directory and the
script prints that path. The snapshot and navigation response live under
`artifacts/`, which is ignored by Git. Inspect the recording locally before
using the profile for a real flow.

## Next boundary

Once the smoke has been observed in a local headed browser, the next increment
is an operator-supervised Flow 1 recording: the browser actor creates the
portfolio and the MCP actor performs only the delegated action it has been
granted. The browser automation must pause before every wallet signature and
must record the post-run withdrawal/reconciliation result. This repository
does not yet automate that real-funds step.
