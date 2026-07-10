import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath } from '@cosmjs/crypto';
import { fundDelegate, getSponsorAddress } from '../sponsor.ts';
import { provisionWallet } from '../provision.ts';
import { createSession } from '../state.ts';

const HD_PATH = "m/44'/564'/0'/0/0";

export async function handleGenerateKey(): Promise<{
  address: string;
  bearerToken: string;
  sponsorTx: string;
  provisionTx: string;
}> {
  const wallet = await DirectSecp256k1HdWallet.generate(24, {
    prefix: 'agoric',
    hdPaths: [stringToPath(HD_PATH)],
  });
  const [{ address }] = await wallet.getAccounts();
  const mnemonic = wallet.mnemonic;

  const sponsorResult = await fundDelegate(address);
  const provisionResult = await provisionWallet(mnemonic, address);

  const bearerToken = createSession(mnemonic, address);

  return {
    address,
    bearerToken,
    sponsorTx: sponsorResult.txHash,
    provisionTx: provisionResult.txHash,
  };
}
