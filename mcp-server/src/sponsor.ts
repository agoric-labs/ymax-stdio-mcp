import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, type StdFee } from '@cosmjs/stargate';
import { stringToPath } from '@cosmjs/crypto';
import { coins } from '@cosmjs/amino';

const HD_PATH = "m/44'/564'/0'/0/0";
const RPC = process.env.RPC_URL || 'https://main.rpc.agoric.net:443';
const SPONSOR_MNEMONIC = process.env.SPONSOR_MNEMONIC;
const SPONSOR_AMOUNT = process.env.SPONSOR_AMOUNT || '20000000'; // 20 BLD

const fail = (msg: string): never => {
  throw new Error(msg);
};

export async function getSponsorAddress(): Promise<string> {
  const mnemonic = SPONSOR_MNEMONIC || fail('SPONSOR_MNEMONIC not set');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'agoric',
    hdPaths: [stringToPath(HD_PATH)],
  });
  const [{ address }] = await wallet.getAccounts();
  return address;
}

export async function fundDelegate(
  delegateAddress: string,
): Promise<{ txHash: string; amount: string }> {
  const mnemonic = SPONSOR_MNEMONIC || fail('SPONSOR_MNEMONIC not set');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'agoric',
    hdPaths: [stringToPath(HD_PATH)],
  });
  const [{ address: sponsorAddress }] = await wallet.getAccounts();

  const client = await SigningStargateClient.connectWithSigner(RPC, wallet);

  const fee: StdFee = {
    amount: coins(5000, 'ubld'),
    gas: '200000',
  };

  const result = await client.sendTokens(
    sponsorAddress,
    delegateAddress,
    coins(Number(SPONSOR_AMOUNT), 'ubld'),
    fee,
    'sponsor funding for delegate',
  );

  if (result.code !== 0) {
    throw new Error(`Sponsor transfer failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash, amount: SPONSOR_AMOUNT };
}
