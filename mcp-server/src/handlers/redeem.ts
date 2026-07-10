import {
  fetchEnvNetworkConfig,
  makeSmartWalletKit,
  makeSigningSmartWalletKit,
  reflectWalletStore,
  retryUntilCondition,
} from '@agoric/client-utils';
import { SigningStargateClient } from '@cosmjs/stargate';
import {
  findPortfolioMandateInvitation,
  getPortfolioMandateDetails,
} from '../invitation.ts';
import { defaultStateStore, type StateStore } from '../state.ts';
import { toolError } from '../responses.ts';
import type { ToolResponse } from '../types.ts';

const delay = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

const makeFee = (gas: number = 2_500_000) => ({
  gas: `${gas}`,
  amount: [{ denom: 'ubld', amount: `${Math.round(gas * 0.03)}` }],
});

export interface RedeemOptions {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  setTimeout: typeof setTimeout;
  now: () => Date;
  stateStore?: StateStore;
}

export async function handleRedeem(
  options: RedeemOptions,
): Promise<ToolResponse> {
  const stateStore = options.stateStore ?? defaultStateStore;
  const activeDelegate = stateStore.getActiveDelegate();
  if (!activeDelegate) {
    return toolError('no active delegate — call generate_delegate_key first');
  }

  const fetch = options.fetch;
  const networkConfig = await fetchEnvNetworkConfig({
    env: options.env,
    fetch,
  });
  const walletKit = await makeSmartWalletKit({ fetch, delay }, networkConfig);

  const ymaxInstance = walletKit.agoricNames.instance['ymax0'];
  if (!ymaxInstance) {
    return toolError('contract ymax0 not found in agoricNames');
  }

  let invitation;
  try {
    invitation = await retryUntilCondition(
      async () => {
        const currentWalletRecord = await walletKit.getCurrentWalletRecord(
          activeDelegate.address,
        );
        return findPortfolioMandateInvitation(currentWalletRecord);
      },
      candidate => candidate !== undefined,
      'portfolioMandate invitation',
      {
        maxRetries: 30,
        retryIntervalMs: 5_000,
        setTimeout: options.setTimeout,
        log: () => {},
      },
    );
  } catch {
    // Empty vstorage and other transient read errors are retried above.
  }

  if (!invitation) {
    return toolError(
      'no portfolioMandate invitation detected after polling — has the grant been completed?',
    );
  }

  const { portfolioId, agentId, permissions } =
    getPortfolioMandateDetails(invitation);

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

  const delegationKeyName = `delegate-portfolio${portfolioId}`;
  const result = await store.saveOfferResult(
    { instance: ymaxInstance, description: `portfolioMandate` },
    delegationKeyName,
    { overwrite: true },
  );

  stateStore.updateActiveDelegate({
    portfolioId,
    delegationKeyName,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'redeemed',
          delegationKey: delegationKeyName,
          redeemTx: result.tx.transactionHash,
          portfolioId,
          agentId,
          permissions,
        }),
      },
    ],
  };
}
