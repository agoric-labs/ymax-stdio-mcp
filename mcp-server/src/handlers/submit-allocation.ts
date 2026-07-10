import {
  fetchEnvNetworkConfig,
  makeSmartWalletKit,
  makeSigningSmartWalletKit,
  reflectWalletStore,
} from '@agoric/client-utils';
import { SigningStargateClient } from '@cosmjs/stargate';
import {
  defaultStateStore,
  hasPortfolioId,
  type StateStore,
} from '../state.ts';
import { registerTransaction } from '../registration.ts';
import { toolError } from '../responses.ts';
import type { AllocationMap, ToolResponse } from '../types.ts';

const delay = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

const makeFee = (gas: number = 2_500_000) => ({
  gas: `${gas}`,
  amount: [{ denom: 'ubld', amount: `${Math.round(gas * 0.03)}` }],
});

export interface SubmitAllocationOptions {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  setTimeout: typeof setTimeout;
  now: () => Date;
  stateStore?: StateStore;
}

function validateAllocations(allocations: AllocationMap): string | undefined {
  for (const [key, value] of Object.entries(allocations)) {
    if (!Number.isFinite(value)) {
      return `allocation for ${key} must be a finite number`;
    }
    if (!Number.isInteger(value)) {
      return `allocation for ${key} must be an integer percentage`;
    }
  }
  return undefined;
}

export async function handleSubmitAllocation(
  allocations: AllocationMap,
  options: SubmitAllocationOptions,
): Promise<ToolResponse> {
  const invalid = validateAllocations(allocations);
  if (invalid) return toolError(invalid);

  const stateStore = options.stateStore ?? defaultStateStore;
  const activeDelegate = stateStore.getActiveDelegate();
  if (!activeDelegate) {
    return toolError('no active delegate — call generate_delegate_key first');
  }
  if (!hasPortfolioId(activeDelegate) || !activeDelegate.delegationKeyName) {
    return toolError('no portfolio state — call redeem_invitation first');
  }

  const fetch = options.fetch;
  const networkConfig = await fetchEnvNetworkConfig({
    env: options.env,
    fetch,
  });
  const walletKit = await makeSmartWalletKit({ fetch, delay }, networkConfig);

  const ssk = await makeSigningSmartWalletKit(
    {
      connectWithSigner: SigningStargateClient.connectWithSigner,
      walletUtils: walletKit,
    },
    activeDelegate.mnemonic,
  );

  const store = reflectWalletStore(ssk, {
    setTimeout: options.setTimeout,
    log: (...args: unknown[]) => console.error('-- wallet-store:', ...args),
    makeNonce: () => options.now().toISOString(),
    fee: makeFee(),
  });

  const status = (await walletKit.readPublished(
    `ymax0.portfolios.portfolio${activeDelegate.portfolioId}`,
  )) as { policyVersion: number; rebalanceCount: number };

  const syncState = {
    policyVersion: status.policyVersion,
    rebalanceCount: status.rebalanceCount,
  };

  const targetAllocation: Record<string, bigint> = {};
  for (const [key, value] of Object.entries(allocations)) {
    targetAllocation[key] = BigInt(value);
  }

  const delegate = store.get<{
    setTargetAllocation: (opts: {
      targetAllocation: Record<string, bigint>;
      syncState: { policyVersion: number; rebalanceCount: number };
    }) => Promise<{
      id?: string;
      tx: { code: number; rawLog?: string; transactionHash: string };
      invocationResult?: unknown;
    }>;
  }>(activeDelegate.delegationKeyName);

  const result = await delegate.setTargetAllocation({
    targetAllocation,
    syncState,
  });

  if (result.tx.code !== 0) {
    return toolError(
      `invokeEntry failed (${result.tx.code}): ${result.tx.rawLog}`,
    );
  }

  const flowKey = result.invocationResult
    ? String(result.invocationResult)
    : undefined;
  await registerTransaction({
    txHash: result.tx.transactionHash,
    portfolioId: activeDelegate.portfolioId,
    flowKey,
  }, {
    env: options.env,
    fetch,
  }).catch((err: Error) =>
    console.error('tx registration failed (non-fatal):', err.message),
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'submitted',
          txHash: result.tx.transactionHash,
          flowKey,
          policyVersion: syncState.policyVersion,
        }),
      },
    ],
  };
}
