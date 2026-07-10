import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePrivateKeyHex,
  getSponsorAddress,
  makeFundingCoins,
  makeSponsorWallet,
} from '../src/sponsor.ts';

const PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001';

test('sponsor amount remains a decimal numeral string', () => {
  assert.deepStrictEqual(makeFundingCoins('9007199254740993'), [
    { denom: 'ubld', amount: '9007199254740993' },
  ]);
});

test('decodePrivateKeyHex accepts 0x-prefixed 32-byte hex', () => {
  const bytes = decodePrivateKeyHex(PRIVATE_KEY);
  assert.strictEqual(bytes.length, 32);
  assert.strictEqual(bytes[31], 1);
});

test('decodePrivateKeyHex rejects invalid private keys', () => {
  assert.throws(
    () => decodePrivateKeyHex('0xabc'),
    /SPONSOR_PRIVATE_KEY must be 32 bytes of hex/,
  );
});

test('makeSponsorWallet supports SPONSOR_PRIVATE_KEY', async () => {
  const wallet = await makeSponsorWallet({
    env: { SPONSOR_PRIVATE_KEY: PRIVATE_KEY },
  });
  const [account] = await wallet.getAccounts();

  assert.match(account.address, /^agoric1/);
  assert.ok(account.pubkey.length > 0);
});

test('getSponsorAddress accepts a raw secp256k1 private key', async () => {
  const address = await getSponsorAddress({
    env: { SPONSOR_PRIVATE_KEY: PRIVATE_KEY },
  });

  assert.match(address, /^agoric1/);
});

test('makeSponsorWallet rejects ambiguous sponsor credentials', async () => {
  assert.throws(
    () =>
      makeSponsorWallet({
        env: {
          SPONSOR_MNEMONIC: 'test test test test test test test test test test test junk',
          SPONSOR_PRIVATE_KEY: PRIVATE_KEY,
        },
      }),
    /set only one of SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY/,
  );
});
