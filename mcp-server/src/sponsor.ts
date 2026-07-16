import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, type StdFee } from '@cosmjs/stargate';
import { stringToPath } from '@cosmjs/crypto';
import { coins } from '@cosmjs/amino';

const HD_PATH = "m/44'/564'/0'/0/0";
export interface SponsorConfig {
  rpcUrl: string;
  amount: string;
  mnemonic?: string;
  privateKey?: string;
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

export const makeFundingCoins = (amount: string) => coins(amount, 'ubld');

function makeSponsorWallet(
  config: SponsorConfig,
): Promise<DirectSecp256k1HdWallet> {
  const { mnemonic, privateKey } = config;

  if (mnemonic && privateKey) {
    fail('set only one of SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY');
  }
  if (mnemonic) {
    return DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: 'agoric',
      hdPaths: [stringToPath(HD_PATH)],
    });
  }
  if (privateKey) {
    const hex = privateKey.startsWith('0x')
      ? privateKey.slice(2)
      : privateKey;
    const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
    return DirectSecp256k1HdWallet.fromKey(bytes, 'agoric');
  }
  return fail('set SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY');
}

export async function getSponsorAddress(config: SponsorConfig): Promise<string> {
  const wallet = await makeSponsorWallet(config);
  const [{ address }] = await wallet.getAccounts();
  return address;
}

export async function fundDelegate(
  delegateAddress: string,
  config: SponsorConfig,
): Promise<{ txHash: string; amount: string }> {
  const wallet = await makeSponsorWallet(config);
  const [{ address: sponsorAddress }] = await wallet.getAccounts();

  const client = await SigningStargateClient.connectWithSigner(
    config.rpcUrl,
    wallet,
  );

  const fee: StdFee = {
    amount: coins(5000, 'ubld'),
    gas: '200000',
  };

  const result = await client.sendTokens(
    sponsorAddress,
    delegateAddress,
    makeFundingCoins(config.amount),
    fee,
    'sponsor funding for delegate',
  );

  if (result.code !== 0) {
    throw new Error(`Sponsor transfer failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash, amount: config.amount };
}
