import {
  fetchEnvNetworkConfig,
  getInvocationUpdate,
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
import { attemptRegistration } from '../registration.ts';
import {
  registrationOutcome,
  submissionRejected,
  toolError,
} from '../responses.ts';
import type { AllocationMap, ToolResponse } from '../types.ts';

const YMAX_INSTANCE = 'ymax0';

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

  // sendOnly returns as soon as the transaction is broadcast. Without it,
  // reflectWalletStore awaits the invocation result internally and throws on a
  // contract rejection, discarding { id, tx } — so a rejected allocation would
  // leave no transaction hash to report or register. We await the verdict below
  // instead, keeping the hash either way.
  const store = reflectWalletStore(ssk, {
    setTimeout: options.setTimeout,
    log: (...args: unknown[]) => console.error('-- wallet-store:', ...args),
    makeNonce: () => options.now().toISOString(),
    fee: makeFee(),
    sendOnly: true,
  });

  const status = (await walletKit.readPublished(
    `${YMAX_INSTANCE}.portfolios.portfolio${activeDelegate.portfolioId}`,
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
    }>;
  }>(activeDelegate.delegationKeyName);

  const result = await delegate.setTargetAllocation({
    targetAllocation,
    syncState,
  });
  const txHash = result.tx.transactionHash;

  // Register before knowing the verdict. A rejected allocation is still a
  // broadcast, gas-charged transaction, and it belongs on the activity page.
  const registration = await attemptRegistration(
    {
      txHash,
      chain: networkConfig.chainName,
      ymaxInstance: YMAX_INSTANCE,
    },
    {
      env: options.env,
      fetch,
    },
  );

  if (result.tx.code !== 0) {
    return submissionRejected(
      {
        txHash,
        policyVersion: syncState.policyVersion,
        error: `invokeEntry failed (${result.tx.code}): ${result.tx.rawLog}`,
      },
      registration,
    );
  }

  // The contract reports an out-of-mandate allocation here, not in the tx code.
  const invocationError = result.id
    ? await getInvocationUpdate(result.id, ssk.query.getLastUpdate, {
        setTimeout: options.setTimeout,
      }).then(
        () => undefined,
        (err: Error) => err.message,
      )
    : undefined;

  if (invocationError) {
    return submissionRejected(
      { txHash, policyVersion: syncState.policyVersion, error: invocationError },
      registration,
    );
  }

  return registrationOutcome(
    'submitted',
    { txHash, policyVersion: syncState.policyVersion },
    registration,
    'setTargetAllocation',
  );
}
