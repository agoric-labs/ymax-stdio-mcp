import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFundingCoins } from '../src/sponsor.ts';

test('sponsor amount remains a decimal numeral string', () => {
  assert.deepStrictEqual(makeFundingCoins('9007199254740993'), [
    { denom: 'ubld', amount: '9007199254740993' },
  ]);
});
