# Contributing

## Agoric SDK Setup

This workspace uses a git worktree of `~/repo/agoric-sdk` on the `dc-agent-skill` branch.

### Initial Setup

```sh
# Ensure the remote branch is fetched and a local tracking branch exists
cd ~/repo/agoric-sdk
git fetch origin dc-agent-skill
git branch dc-agent-skill origin/dc-agent-skill

# Add the worktree under yield1
git worktree add /Users/connolly/Documents/yield1/agoric-sdk dc-agent-skill
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
