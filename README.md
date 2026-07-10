# YMax Yield Agent — MCP Server

MCP server for a delegated YMax allocation agent on Agoric mainnet. Wraps key generation, smart-wallet provisioning, invitation redemption, and target-allocation submission as MCP tools.

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
| `redeem_invitation` | Poll for and redeem `portfolioMandate` invitation after user grant |
| `submit_target_allocation` | Submit a `setTargetAllocation` transaction via the delegation key |
| `rotate_token` | Invalidate bearer token and issue a new one |

## Resources

| Resource | Description |
|---|---|
| `solver-constraints` | Multi-layer minimum transfer thresholds enforced by the YMax solver |
| `provisioning-runbook` | Correct ordering: provision before grant |
| `ymax-onboarding` | Complete onboarding guide with role boundaries and failure triage |
| `ymax-allocation-delegate` | Allocation guardrails, candidate-building heuristics, and escalation rules |

## Architecture

- **Read side**: YDS (YMax Data Service) — portfolio state, APYs, flow status
- **Write side**: This MCP server — signing-key operations only
- **Mnemonic isolation**: Key material is generated inside the server and never exposed to the client
- **Bearer token auth**: Opaque session token returned by `generate_delegate_key`

See [mcp-design.md](./mcp-design.md) for the full design rationale.

## Experience Reports

Lessons learned from live mainnet operation — see [experience-reports.md](./experience-reports.md).
