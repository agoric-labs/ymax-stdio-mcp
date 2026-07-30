# Contributing

## Agoric Dependencies

The MCP server uses pinned npm dev releases of its Agoric packages. It does
not require an `agoric-sdk` checkout, a Nix development environment, or an
`agd` binary. Install dependencies with:

```sh
cd mcp-server
npm install
```

When updating Agoric packages, keep their dev releases on the same SDK commit
and save the resolved versions exactly.

## Commit Discipline

Prefer atomic commits: each commit should capture one coherent change and include the tests or docs needed to understand it. Avoid mixing unrelated refactors, formatting churn, generated output, and behavior changes in the same commit.

Use Conventional Commits for commit messages:

```text
type(scope): short imperative summary
```

Common types include `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, and `build`. Use a scope when it helps, such as `mcp-server` or `docs`.

## TypeScript capability patterns

- **Composition-Root Defaults** — only `main` connects ambient powers through
  default arguments; helpers require explicit capabilities. See
  `pinchtab/flow1.ts:113`.
- **Explicit Agent Powers** — agent runners receive `query`, `cwd`, and `env`;
  do not default them inside helpers. See `pinchtab/local-agent.ts:13`.
- **Inferred Capability Surface** — prefer inferred local types and derive
  public factory interfaces with `ReturnType`/`Awaited` rather than duplicating
  object shapes. See `pinchtab/pinchtab-api.ts:184`.
- **Normal Agent Surface + Local MCP** — keep Claude Code's normal tools and
  add all tools from the explicitly configured stdio MCP server. See
  `pinchtab/flow1.ts:65` and `pinchtab/local-agent.ts:40`.
- **Expected-Artifact Validation** — the MCP produces proposal URLs; drivers
  find and validate the expected origin and shape rather than recomputing them.
  See `pinchtab/flow2.ts:39`.
- **Extension Target Bridge** — address MetaMask notification targets through
  Chromium debugging when PinchTab omits them from `/tabs`. See
  `pinchtab/pinchtab-api.ts:82`.
- **Interactive Recording Boundary** — start browser recording before the
  interactive agent and finalize it after the agent exits. See
  `pinchtab/flow1.ts:203`.
- **Explicit Real-Funds Knob** — real-money scripts require an explicit bounded
  amount; never choose a spend amount by default. See `pinchtab/flow1.ts:19`.
