# YMax Yield Agent — MCP Server

MCP server for a delegated YMax allocation agent on Agoric mainnet. It builds owner-approval links and wraps key generation, smart-wallet provisioning, invitation redemption, and delegated allocation submission as MCP tools.

## Prerequisites

- Node.js 22+
- A built Agoric SDK worktree at `./agoric-sdk/` (see [CONTRIBUTING.md](./CONTRIBUTING.md))
- A funded sponsor BLD wallet for delegate key creation

## Install

```sh
cd mcp-server
npm install
```

## Configure

Copy `.env.example` to `.env` and fill in the sponsor wallet seed:

```sh
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `SPONSOR_MNEMONIC` or `SPONSOR_PRIVATE_KEY` | Yes | Seed for the BLD wallet that funds new delegates |
| `RPC_URL` | No | Agoric RPC endpoint (defaults to mainnet) |
| `SPONSOR_AMOUNT` | No | BLD to send per delegate (default `20000000` = 20 BLD) |
| `YMAX_UI_URL` | No | YMax UI for proposal links (defaults to the agentic UI preview) |
| `YDS_URL` | No | YDS endpoint used to register submitted transactions |
| `CHAIN_ID` | No | Chain identifier sent to YDS (default `agoric-3`) |
| `YMAX_INSTANCE` | No | YMax instance sent to YDS (default `ymax0`) |

## Start

```sh
npm start        # production
npm run dev      # watch mode (restarts on file change)
```

The server speaks MCP over stdio. Configure your MCP client to launch it with:

```json
{
  "ymax-yield-agent": {
    "command": "node",
    "args": ["--import", "tsx", "/path/to/mcp-server/src/server.ts"],
    "env": { /* or use .env */ }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `generate_delegate_key` | Create delegate key, fund from sponsor, provision smart wallet |
| `propose_create` | Build one UI link for portfolio creation and delegation |
| `redeem_invitation` | Redeem `portfolioMandate` and derive its portfolio binding |
| `propose_grant` | Build a delegation link for an existing portfolio |
| `propose_edit` | Build a pre-populated owner-approved portfolio edit link |
| `submit_target_allocation` | Submit a `setTargetAllocation` transaction via the delegation key |

## Resources

| Resource | Description |
|---|---|
| `solver-constraints` | Multi-layer minimum transfer thresholds enforced by the YMax solver |
| `provisioning-runbook` | Correct ordering: provision before grant |
| `ymax-onboarding` | Complete onboarding guide with role boundaries and failure triage |
| `ymax-allocation-delegate` | Allocation guardrails, candidate-building heuristics, and escalation rules |

## Architecture

- **Read side**: YDS (YMax Data Service) — portfolio state, APYs, flow status
- **Action side**: This MCP server — proposal links and signing-key operations
- **Mnemonic isolation**: Key material is generated inside the server and never exposed to the client
- **Single-user state**: Delegate key material and portfolio binding remain inside the server

See [mcp-design.md](./mcp-design.md) for the full design rationale.

## Experience Reports

Lessons learned from live mainnet operation — see [experience-reports.md](./experience-reports.md).
