import {
  DirectSecp256k1HdWallet,
  DirectSecp256k1Wallet,
  type OfflineSigner,
} from '@cosmjs/proto-signing';
import { SigningStargateClient, type StdFee } from '@cosmjs/stargate';
import { stringToPath } from '@cosmjs/crypto';
import { coins } from '@cosmjs/amino';

const HD_PATH = "m/44'/564'/0'/0/0";
const DEFAULT_RPC_URL = 'https://main.rpc.agoric.net:443';
const DEFAULT_SPONSOR_AMOUNT = '20000000'; // 20 BLD

export interface SponsorOptions {
  env: NodeJS.ProcessEnv;
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

export function decodePrivateKeyHex(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith('0x')
    ? privateKey.slice(2)
    : privateKey;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    fail('SPONSOR_PRIVATE_KEY must be 32 bytes of hex');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export const makeFundingCoins = (amount: string) => coins(amount, 'ubld');

export function makeSponsorWallet(
  options: SponsorOptions,
): Promise<OfflineSigner> {
  const mnemonic = options.env.SPONSOR_MNEMONIC;
  const privateKey = options.env.SPONSOR_PRIVATE_KEY;

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
    return DirectSecp256k1Wallet.fromKey(
      decodePrivateKeyHex(privateKey),
      'agoric',
    );
  }
  return fail('set SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY');
}

export async function getSponsorAddress(
  options: SponsorOptions,
): Promise<string> {
  const wallet = await makeSponsorWallet(options);
  const [{ address }] = await wallet.getAccounts();
  return address;
}

export async function fundDelegate(
  delegateAddress: string,
  options: SponsorOptions,
): Promise<{ txHash: string; amount: string }> {
  const wallet = await makeSponsorWallet(options);
  const [{ address: sponsorAddress }] = await wallet.getAccounts();
  const rpcUrl = options.env.RPC_URL || DEFAULT_RPC_URL;
  const sponsorAmount =
    options.env.SPONSOR_AMOUNT || DEFAULT_SPONSOR_AMOUNT;

  const client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet);

  const fee: StdFee = {
    amount: coins(5000, 'ubld'),
    gas: '200000',
  };

  const result = await client.sendTokens(
    sponsorAddress,
    delegateAddress,
    makeFundingCoins(sponsorAmount),
    fee,
    'sponsor funding for delegate',
  );

  if (result.code !== 0) {
    throw new Error(`Sponsor transfer failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash, amount: sponsorAmount };
}
