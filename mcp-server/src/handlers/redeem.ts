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
import type { SessionStore } from '../state.ts';
import { toolError } from '../responses.ts';
import type { ToolResponse } from '../types.ts';

const delay = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

const makeFee = (gas: number = 2_500_000) => ({
  gas: `${gas}`,
  amount: [{ denom: 'ubld', amount: `${Math.round(gas * 0.03)}` }],
});

export interface RedeemIO {
  fetch: typeof globalThis.fetch;
  agoricNet: string;
  state: Pick<SessionStore, 'getSession' | 'updateSession'>;
}

export async function handleRedeem(io: RedeemIO): Promise<ToolResponse> {
  const session = io.state.getSession();
  if (!session) {
    return toolError('no delegate state — call generate_delegate_key first');
  }

  const networkConfig = await fetchEnvNetworkConfig({
    env: { AGORIC_NET: io.agoricNet },
    fetch: io.fetch,
  });
  const walletKit = await makeSmartWalletKit(
    { fetch: io.fetch, delay },
    networkConfig,
  );

  const ymaxInstance = walletKit.agoricNames.instance['ymax0'];
  if (!ymaxInstance) {
    return toolError('contract ymax0 not found in agoricNames');
  }

  let invitation;
  try {
    invitation = await retryUntilCondition(
      async () => {
        const currentWalletRecord = await walletKit.getCurrentWalletRecord(
          session.address,
        );
        return findPortfolioMandateInvitation(currentWalletRecord);
      },
      candidate => candidate !== undefined,
      'portfolioMandate invitation',
      {
        maxRetries: 30,
        retryIntervalMs: 5_000,
        setTimeout: globalThis.setTimeout,
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

  // Create signing wallet kit
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

  const delegationKeyName = `delegate-portfolio${portfolioId}`;
  const result = await store.saveOfferResult(
    { instance: ymaxInstance, description: `portfolioMandate` },
    delegationKeyName,
    { overwrite: true },
  );

  io.state.updateSession({
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
