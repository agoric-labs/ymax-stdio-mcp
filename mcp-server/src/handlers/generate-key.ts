import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath } from '@cosmjs/crypto';
import { fundDelegate, type SponsorConfig } from '../sponsor.ts';
import { provisionWallet, type ProvisionConfig } from '../provision.ts';
import type { SessionStore } from '../state.ts';

const HD_PATH = "m/44'/564'/0'/0/0";

export async function handleGenerateKey(
  state: Pick<SessionStore, 'setSession'>,
  config: { sponsor: SponsorConfig; provision: ProvisionConfig },
): Promise<{
  address: string;
  sponsorTx: string;
  provisionTx: string;
}> {
  const wallet = await DirectSecp256k1HdWallet.generate(24, {
    prefix: 'agoric',
    hdPaths: [stringToPath(HD_PATH)],
  });
  const [{ address }] = await wallet.getAccounts();
  const mnemonic = wallet.mnemonic;

  const sponsorResult = await fundDelegate(address, config.sponsor);
  const provisionResult = await provisionWallet(
    mnemonic,
    address,
    config.provision,
  );

  state.setSession(mnemonic, address);

  return {
    address,
    sponsorTx: sponsorResult.txHash,
    provisionTx: provisionResult.txHash,
  };
}
