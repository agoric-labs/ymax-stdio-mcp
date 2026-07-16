import {
  fetchEnvNetworkConfig,
  makeSmartWalletKit,
  makeSigningSmartWalletKit,
  reflectWalletStore,
} from '@agoric/client-utils';
import { SigningStargateClient } from '@cosmjs/stargate';
import { getSession } from '../state.ts';
import { registerTransaction } from '../registration.ts';
import type { AllocationMap, ToolResponse } from '../types.ts';

const delay = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

const makeFee = (gas: number = 2_500_000) => ({
  gas: `${gas}`,
  amount: [{ denom: 'ubld', amount: `${Math.round(gas * 0.03)}` }],
});

export async function handleSubmitAllocation(
  allocations: AllocationMap,
): Promise<ToolResponse> {
  const session = getSession();
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: 'no delegate state — call generate_delegate_key first',
        },
      ],
    };
  }
  if (!session.portfolioId || !session.delegationKeyName) {
    return {
      content: [
        {
          type: 'text',
          text: 'no portfolio state — call redeem_invitation first',
        },
      ],
    };
  }

  const fetch = globalThis.fetch.bind(globalThis);
  const networkConfig = await fetchEnvNetworkConfig({ env: process.env, fetch });
  const walletKit = await makeSmartWalletKit({ fetch, delay }, networkConfig);

  const ssk = await makeSigningSmartWalletKit(
    {
      connectWithSigner: SigningStargateClient.connectWithSigner,
      walletUtils: walletKit,
    },
    session.mnemonic,
  );

  const store = reflectWalletStore(ssk, {
    setTimeout: globalThis.setTimeout,
    log: (...args: unknown[]) => console.error('-- wallet-store:', ...args),
    makeNonce: () => new Date().toISOString(),
    fee: makeFee(),
  });

  // Read current sync state from published data
  const status = (await walletKit.readPublished(
    `ymax0.portfolios.portfolio${session.portfolioId}`,
  )) as { policyVersion: number; rebalanceCount: number };

  const syncState = {
    policyVersion: status.policyVersion,
    rebalanceCount: status.rebalanceCount,
  };

  // Convert allocations to bigint map
  const targetAllocation: Record<string, bigint> = {};
  for (const [key, value] of Object.entries(allocations)) {
    targetAllocation[key] = BigInt(Math.round(value)); // percentage points
  }

  // Get the delegation client and submit
  const delegate = store.get<{
    setTargetAllocation: (opts: {
      targetAllocation: Record<string, bigint>;
      syncState: { policyVersion: number; rebalanceCount: number };
    }) => Promise<{
      id?: string;
      tx: { code: number; rawLog?: string; transactionHash: string };
      invocationResult?: unknown;
    }>;
  }>(session.delegationKeyName);

  const result = await delegate.setTargetAllocation({
    targetAllocation,
    syncState,
  });

  if (result.tx.code !== 0) {
    return {
      content: [
        {
          type: 'text',
          text: `invokeEntry failed (${result.tx.code}): ${result.tx.rawLog}`,
        },
      ],
    };
  }

  // Auto-register the transaction
  const flowKey = result.invocationResult
    ? String(result.invocationResult)
    : undefined;
  await registerTransaction({
    txHash: result.tx.transactionHash,
    portfolioId: session.portfolioId,
    flowKey,
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
