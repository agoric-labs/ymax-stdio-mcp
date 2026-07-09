import { fromBech32, toUtf8 } from '@cosmjs/encoding';
import { stringToPath } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet, Registry } from '@cosmjs/proto-signing';
import { SigningStargateClient } from '@cosmjs/stargate';
import { readFile } from 'node:fs/promises';

const RPC = 'https://main.rpc.agoric.net:443';
const CHAIN_ID = 'agoric-3';
const ENV_FILE = '/Users/connolly/Documents/yield1/.secrets/ymax-agent-portfolio84.env';
const HD_PATH = "m/44'/564'/0'/0/0";
const MSG_WALLET_SPEND_ACTION_TYPE_URL = '/agoric.swingset.MsgWalletSpendAction';
const INSTANCE_BOARD_ID = 'board041540';
const DELEGATION_KEY = 'delegate-portfolio84';

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

const MsgWalletSpendAction = {
  typeUrl: MSG_WALLET_SPEND_ACTION_TYPE_URL,
  fromPartial: object => ({
    owner: object.owner ?? new Uint8Array(),
    spendAction: object.spendAction ?? '',
  }),
  encode: message => ({
    finish: () =>
      Uint8Array.from([
        ...encodeBytesField(1, message.owner),
        ...encodeStringField(2, message.spendAction),
      ]),
  }),
};

const makeSpendAction = id =>
  JSON.stringify({
    body:
      '#' +
      JSON.stringify({
        method: 'executeOffer',
        offer: {
          id,
          invitationSpec: {
            source: 'purse',
            instance: '$0.Alleged: InstanceHandle',
            description: 'portfolioMandate',
          },
          proposal: {},
          saveResult: {
            name: DELEGATION_KEY,
            overwrite: true,
          },
        },
      }),
    slots: [INSTANCE_BOARD_ID],
  });

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
  registry.register(MSG_WALLET_SPEND_ACTION_TYPE_URL, MsgWalletSpendAction);
  const client = await SigningStargateClient.connectWithSigner(RPC, wallet, {
    registry,
  });

  const id = `portfolioMandate.${new Date().toISOString()}`;
  const msg = {
    typeUrl: MSG_WALLET_SPEND_ACTION_TYPE_URL,
    value: MsgWalletSpendAction.fromPartial({
      owner: bech32Data(address),
      spendAction: makeSpendAction(id),
    }),
  };
  const fee = {
    amount: [{ denom: 'ubld', amount: '75000' }],
    gas: '2500000',
  };

  const result = await client.signAndBroadcast(address, [msg], fee, '');
  console.log(
    JSON.stringify(
      {
        address,
        chainId: CHAIN_ID,
        offerId: id,
        delegationKey: DELEGATION_KEY,
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
    throw Error(`Redeem failed with code ${result.code}: ${result.rawLog}`);
  }
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
