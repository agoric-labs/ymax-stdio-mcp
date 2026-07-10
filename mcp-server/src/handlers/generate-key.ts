import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath } from '@cosmjs/crypto';
import { fundDelegate, type SponsorOptions } from '../sponsor.ts';
import { provisionWallet } from '../provision.ts';
import { defaultStateStore, type StateStore } from '../state.ts';

const HD_PATH = "m/44'/564'/0'/0/0";

export interface GenerateKeyOptions {
  env: SponsorOptions['env'];
  stateStore?: StateStore;
}

export async function handleGenerateKey(
  clobberActiveDelegate: boolean,
  options: GenerateKeyOptions,
): Promise<{
  address: string;
  sponsorTx: string;
  provisionTx: string;
}> {
  const stateStore = options.stateStore ?? defaultStateStore;
  if (stateStore.getActiveDelegate() && !clobberActiveDelegate) {
    throw new Error(
      'active delegate already exists; pass clobberActiveDelegate=true to replace it',
    );
  }

  const wallet = await DirectSecp256k1HdWallet.generate(24, {
    prefix: 'agoric',
    hdPaths: [stringToPath(HD_PATH)],
  });
  const [{ address }] = await wallet.getAccounts();
  const mnemonic = wallet.mnemonic;

  const sponsorResult = await fundDelegate(address, options);
  const provisionResult = await provisionWallet(mnemonic, address, options);

  stateStore.createActiveDelegate(mnemonic, address);

  return {
    address,
    sponsorTx: sponsorResult.txHash,
    provisionTx: provisionResult.txHash,
  };
}
