import { fromBech32, toUtf8 } from '@cosmjs/encoding';
import { stringToPath } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet, Registry } from '@cosmjs/proto-signing';
import { SigningStargateClient } from '@cosmjs/stargate';
import { readFile } from 'node:fs/promises';

const RPC = 'https://main.rpc.agoric.net:443';
const CHAIN_ID = 'agoric-3';
const ENV_FILE = '/Users/connolly/Documents/yield1/.secrets/ymax-agent-portfolio84.env';
const HD_PATH = "m/44'/564'/0'/0/0";
const MSG_PROVISION_TYPE_URL = '/agoric.swingset.MsgProvision';

const parseEnvExports = text =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map(line => line.match(/^export ([A-Z_]+)=(?:"([^"]*)"|(.*))$/))
      .filter(Boolean)
      .map(match => [match[1], match[2] ?? match[3] ?? '']),
  );

const bech32Data = address => Uint8Array.from(fromBech32(address).data);

const varint = value => {
  const out = [];
  let n = BigInt(value);
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
};

const field = (fieldNumber, wireType) => varint((BigInt(fieldNumber) << 3n) | BigInt(wireType));

const lengthDelimited = bytes => [...varint(bytes.length), ...bytes];

const encodeStringField = (fieldNumber, value) => [
  ...field(fieldNumber, 2),
  ...lengthDelimited(toUtf8(value)),
];

const encodeBytesField = (fieldNumber, value) => [
  ...field(fieldNumber, 2),
  ...lengthDelimited(value),
];

const MsgProvision = {
  typeUrl: MSG_PROVISION_TYPE_URL,
  fromPartial: object => ({
    nickname: object.nickname ?? '',
    address: object.address ?? new Uint8Array(),
    powerFlags: object.powerFlags ?? [],
    submitter: object.submitter ?? new Uint8Array(),
  }),
  encode: message => ({
    finish: () =>
      Uint8Array.from([
        ...encodeStringField(1, message.nickname),
        ...encodeBytesField(2, message.address),
        ...message.powerFlags.flatMap(flag => encodeStringField(3, flag)),
        ...encodeBytesField(4, message.submitter),
      ]),
  }),
};

const main = async () => {
  const env = parseEnvExports(await readFile(ENV_FILE, 'utf8'));
  if (!env.MNEMONIC || !env.AGENT_ADDRESS) {
    throw Error(`Missing MNEMONIC or AGENT_ADDRESS in ${ENV_FILE}`);
  }

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(env.MNEMONIC, {
    prefix: 'agoric',
    hdPaths: [stringToPath(HD_PATH)],
  });
  const [{ address }] = await wallet.getAccounts();
  if (address !== env.AGENT_ADDRESS) {
    throw Error(`Derived ${address}, expected ${env.AGENT_ADDRESS}`);
  }

  const registry = new Registry();
  registry.register(MSG_PROVISION_TYPE_URL, MsgProvision);

  const client = await SigningStargateClient.connectWithSigner(RPC, wallet, {
    registry,
  });

  const addressBytes = bech32Data(address);
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
  console.log(
    JSON.stringify(
      {
        address,
        chainId: CHAIN_ID,
        code: result.code,
        transactionHash: result.transactionHash,
        height: result.height,
        rawLog: result.rawLog,
      },
      null,
      2,
    ),
  );
  if (result.code !== 0) {
    throw Error(`Provision failed with code ${result.code}: ${result.rawLog}`);
  }
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
