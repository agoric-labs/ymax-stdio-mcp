import test from 'node:test';
import assert from 'node:assert/strict';
import { getSponsorAddress, makeFundingCoins } from '../src/sponsor.ts';

test('sponsor amount remains a decimal numeral string', () => {
  assert.deepStrictEqual(makeFundingCoins('9007199254740993'), [
    { denom: 'ubld', amount: '9007199254740993' },
  ]);
});

test('sponsor accepts a raw secp256k1 private key', async () => {
  const address = await getSponsorAddress({
    rpcUrl: 'http://unused.invalid',
    amount: '1',
    privateKey: '1'.padStart(64, '0'),
  });

  assert.match(address, /^agoric1/);
});
