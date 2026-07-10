import {
  fetchEnvNetworkConfig,
  makeSmartWalletKit,
  makeSigningSmartWalletKit,
  reflectWalletStore,
} from '@agoric/client-utils';
import { SigningStargateClient } from '@cosmjs/stargate';
import { getSession, updateSession } from '../state.ts';
import type { ToolResponse } from '../types.ts';

const delay = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

const makeFee = (gas: number = 2_500_000) => ({
  gas: `${gas}`,
  amount: [{ denom: 'ubld', amount: `${Math.round(gas * 0.03)}` }],
});

export async function handleRedeem(
  bearerToken: string,
  portfolioId: number,
): Promise<ToolResponse> {
  const session = getSession(bearerToken);
  if (!session) {
    return {
      content: [{ type: 'text', text: 'unauthorized' }],
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

  // Poll for the portfolioMandate invitation
  let invitation: { description: string } | undefined;
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    const state = await walletKit.storedWalletState(session.address);
    for (const inv of state.invitationsReceived.values()) {
      if (
        inv.description === `portfolioMandate` &&
        JSON.stringify(inv.instance) === JSON.stringify(ymaxInstance)
      ) {
        invitation = inv;
        break;
      }
    }
    if (invitation) break;
    await delay(5_000);
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

  updateSession(bearerToken, {
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
        }),
      },
    ],
  };
}
