# MCP Server Review Findings

Date: 2026-07-10

Scope: `mcp-server/`

## Findings

### P1: Resolved by removing bearer-token tool auth

Original finding: `generate_delegate_key` returned a bearer token in MCP tool `content`. MCP `content` is model-visible, so this was not a useful security boundary for a local configured MCP caller.

Resolution in current patch: removed bearer-token tool auth. The configured MCP caller is treated as authorized, `generate_delegate_key` stores the active delegate locally, and later tools use that active delegate without a token argument.

### P1: Environment access should stay at the entrypoint

Several modules previously captured `process.env` at module load, including sponsor funding, wallet provisioning, and transaction registration. This made `.env` loading order fragile and hid authority in helper modules.

Resolution in current patch: production powers are assembled in `server.ts` and passed explicitly into handlers and lower-level modules.

### P1: `SPONSOR_PRIVATE_KEY` path was not covered and used the wrong wallet class

The private-key sponsor path used `DirectSecp256k1HdWallet.fromKey`, which is not available on that class. This path should use the non-HD `DirectSecp256k1Wallet.fromKey`.

Resolution in current patch: changed the implementation and added unit coverage for `SPONSOR_PRIVATE_KEY`.

### P2: Tests should not use the production state path

The state module previously fixed its JSON path at module load, and tests mutated the same store used by the MCP server.

Resolution in current patch: added `makeStateStore(file)` and updated tests to use temp-file-backed stores.

### P2: Allocation values should not be silently rounded

`submit_target_allocation` previously rounded allocation values before converting them to bigint. That could submit an allocation different from what the caller intended.

Resolution in current patch: non-finite and non-integer allocation values are rejected before network or chain access.

## POLA / `@agoric/pola-io` Note

`@agoric/pola-io` is available in the sibling Agoric SDK and is a good fit for a future cleanup of file/network authority. The current patch keeps explicit injected powers without adopting `pola-io`, because `makeFileRW` is async while the current state API is synchronous, and `makeWebRd` is read-oriented while transaction registration performs POST. A clean migration would likely make the state store async and introduce an explicit POST-capability wrapper.

## Verification

- `npm test` passes: 25 tests.
- `npm exec tsc -- --noEmit` still fails on an external Agoric SDK type error in `../agoric-sdk/packages/zoe/src/contractFacet/types.ts`.
