import {
  fetchEnvNetworkConfig,
  makeSmartWalletKit,
  makeSigningSmartWalletKit,
  reflectWalletStore,
  retryUntilCondition,
} from '@agoric/client-utils';
import { SigningStargateClient } from '@cosmjs/stargate';
import { getPortfolioMandateDetails } from '../invitation.ts';
import { getSession, updateSession } from '../state.ts';
import type { ToolResponse } from '../types.ts';

const delay = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

const makeFee = (gas: number = 2_500_000) => ({
  gas: `${gas}`,
  amount: [{ denom: 'ubld', amount: `${Math.round(gas * 0.03)}` }],
});

export async function handleRedeem(): Promise<ToolResponse> {
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

  const fetch = globalThis.fetch.bind(globalThis);
  const networkConfig = await fetchEnvNetworkConfig({ env: process.env, fetch });
  const walletKit = await makeSmartWalletKit({ fetch, delay }, networkConfig);

  const ymaxInstance = walletKit.agoricNames.instance['ymax0'];
  if (!ymaxInstance) {
    return {
      content: [{ type: 'text', text: 'contract ymax0 not found in agoricNames' }],
    };
  }

  let invitation;
  try {
    invitation = await retryUntilCondition(
      async () => {
        const state = await walletKit.storedWalletState(session.address);
        return [...state.invitationsReceived.values()].find(
          candidate =>
            candidate.description === 'portfolioMandate' &&
            JSON.stringify(candidate.instance) === JSON.stringify(ymaxInstance),
        );
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
    return {
      content: [
        {
          type: 'text',
          text: 'no portfolioMandate invitation detected after polling — has the grant been completed?',
        },
      ],
    };
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

  updateSession({
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
