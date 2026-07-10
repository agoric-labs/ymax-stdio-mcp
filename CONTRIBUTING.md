# Contributing

## Agoric SDK Setup

This workspace requires a built agoric-sdk worktree at `./agoric-sdk/` for the MCP server's local package dependencies (`@agoric/client-utils`, `@agoric/cosmic-proto`, etc.).

### Initial Setup

```sh
# Add a worktree from your agoric-sdk checkout
cd ~/repo/agoric-sdk
git worktree add /Users/connolly/Documents/yield1/agoric-sdk <branch-or-tag>
```

### Build

The SDK requires specific versions of Node.js and Go. Use `nix develop` to get the right toolchain:

```sh
nix develop /Users/connolly/Documents/yield1/agoric-sdk -c bash -c "
  cd /Users/connolly/Documents/yield1/agoric-sdk && \
  yarn && \
  yarn build
"

nix develop /Users/connolly/Documents/yield1/agoric-sdk -c \
  /Users/connolly/Documents/yield1/agoric-sdk/bin/agd build
```

This will:
1. Install JS dependencies via Yarn
2. Build all workspace packages (kernel bundles, contract bundles, GraphQL codegen, etc.)
3. Compile the `agd` Go binary, the `libagcosmosdaemon.so` shared library, and the `agcosmosdaemon.node` native addon

## Commit Discipline

Prefer atomic commits: each commit should capture one coherent change and include the tests or docs needed to understand it. Avoid mixing unrelated refactors, formatting churn, generated output, and behavior changes in the same commit.

Use Conventional Commits for commit messages:

```text
type(scope): short imperative summary
```

Common types include `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, and `build`. Use a scope when it helps, such as `mcp-server` or `docs`.
