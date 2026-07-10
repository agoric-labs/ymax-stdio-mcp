import { fromBech32, toUtf8 } from '@cosmjs/encoding';
import { stringToPath } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet, Registry } from '@cosmjs/proto-signing';
import { SigningStargateClient } from '@cosmjs/stargate';

const DEFAULT_RPC_URL = 'https://main.rpc.agoric.net:443';

const MSG_PROVISION_TYPE_URL = '/agoric.swingset.MsgProvision';
const HD_PATH = "m/44'/564'/0'/0/0";

export interface ProvisionOptions {
  env: NodeJS.ProcessEnv;
}

const varint = (value: bigint): number[] => {
  const out: number[] = [];
  let n = value;
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
};

const field = (fieldNumber: number, wireType: number) =>
  varint((BigInt(fieldNumber) << 3n) | BigInt(wireType));

const lengthDelimited = (bytes: Uint8Array) => [
  ...varint(BigInt(bytes.length)),
  ...bytes,
];

const encodeStringField = (fieldNumber: number, value: string) => [
  ...field(fieldNumber, 2),
  ...lengthDelimited(toUtf8(value)),
];

const encodeBytesField = (fieldNumber: number, value: Uint8Array) => [
  ...field(fieldNumber, 2),
  ...lengthDelimited(value),
];

const MsgProvision = {
  typeUrl: MSG_PROVISION_TYPE_URL,
  fromPartial: (object: {
    nickname?: string;
    address?: Uint8Array;
    powerFlags?: string[];
    submitter?: Uint8Array;
  }) => ({
    nickname: object.nickname ?? '',
    address: object.address ?? new Uint8Array(),
    powerFlags: object.powerFlags ?? [],
    submitter: object.submitter ?? new Uint8Array(),
  }),
  encode: (message: {
    nickname: string;
    address: Uint8Array;
    powerFlags: string[];
    submitter: Uint8Array;
  }) => ({
    finish: () =>
      Uint8Array.from([
        ...encodeStringField(1, message.nickname),
        ...encodeBytesField(2, message.address),
        ...message.powerFlags.flatMap(flag => encodeStringField(3, flag)),
        ...encodeBytesField(4, message.submitter),
      ]),
  }),
};

export async function provisionWallet(
  mnemonic: string,
  address: string,
  options: ProvisionOptions,
): Promise<{ txHash: string }> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'agoric',
    hdPaths: [stringToPath(HD_PATH)],
  });

  const [{ address: derived }] = await wallet.getAccounts();
  if (derived !== address) {
    throw new Error(`Derived ${derived}, expected ${address}`);
  }

  const registry = new Registry();
  registry.register(MSG_PROVISION_TYPE_URL, MsgProvision as any);

  const client = await SigningStargateClient.connectWithSigner(
    options.env.RPC_URL || DEFAULT_RPC_URL,
    wallet,
    { registry },
  );

  const addressBytes = Uint8Array.from(fromBech32(address).data);

  const msg = {
    typeUrl: MSG_PROVISION_TYPE_URL,
    value: MsgProvision.fromPartial({
      nickname: 'my-wallet',
      address: addressBytes,
      powerFlags: ['SMART_WALLET'],
      submitter: addressBytes,
    }),
  };

  const fee = {
    amount: [{ denom: 'ubld', amount: '30000' }],
    gas: '1000000',
  };

  const result = await client.signAndBroadcast(address, [msg], fee, '');

  if (result.code !== 0) {
    throw new Error(
      `Provision failed (${result.code}): ${result.rawLog}`,
    );
  }

  return { txHash: result.transactionHash };
}
