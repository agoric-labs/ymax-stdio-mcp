# Experience Report: Mandate Enforcement for Out-of-Scope Allocation Requests

## Objective

Test that the YMax portfolio contract on Agoric mainnet correctly rejects `setTargetAllocation` requests targeting instruments not present in the portfolio's current allowed key set.

## Setup

- **Portfolio**: `portfolio84` on `ymax0` (Agoric mainnet)
- **Delegate**: `delegate-portfolio84` (allocation-only authority) — see [onboarding report](./ymax-agent-onboarding-experience-report.md) for wallet creation, funding, and invitation redemption
- **Current instrument keys**: 7 Morpho/Compound vaults only — no Aave instruments
- **Test file**: `allocations-portfolio84-aave-avalanche-test.json`

## Test Request

Submitted an allocation setting all current instruments to 0 and adding `Aave_Avalanche` at 100:

```json
{
  "Compound_Base": 0,
  "Compound_Optimism": 0,
  "ERC4626_morphoAlphaUsdcCore_Ethereum": 0,
  "ERC4626_morphoGauntletUsdcRwa_Ethereum": 0,
  "ERC4626_morphoHyperithmUsdcDegen_Ethereum": 0,
  "ERC4626_morphoClearstarUsdcReactor_Ethereum": 0,
  "ERC4626_morphoSteakhouseHighYieldInstant_Ethereum": 0,
  "Aave_Avalanche": 100
}
```

## Result

The contract rejected the submission with:

```
Error: unauthorized allocations for ["Aave_Avalanche"]
```

## Analysis

- The contract correctly identified `Aave_Avalanche` as an instrument key not present in the portfolio's current instrument set.
- The rejection happened at the contract level, before any funds were moved.
- The delegate's `setTargetAllocation` scope is properly constrained — it cannot add new instruments, only adjust weights within the existing set.
- The error message lists the offending key(s), which is helpful for debugging.

## Takeaway

The mandate enforcement works as designed. A delegate with `{ allocation: true }` authority cannot expand the portfolio's instrument universe — it is strictly limited to rebalancing among the keys that were set at portfolio creation time. Any attempt to allocate to an unrecognized instrument key is rejected with a clear error before execution.
