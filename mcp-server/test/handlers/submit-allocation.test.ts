import '@endo/init';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSubmitAllocation } from '../../src/handlers/submit-allocation.ts';
import { makeStateStore } from '../../src/state.ts';

const unusedPowers = {
  env: {},
  fetch: (async () => {
    throw new Error('unexpected fetch');
  }) as typeof fetch,
  setTimeout,
  now: () => new Date('2026-07-10T00:00:00.000Z'),
  stateStore: makeStateStore(
    join(tmpdir(), `ymax-mcp-submit-test-${crypto.randomUUID()}.json`),
  ),
};

test('handleSubmitAllocation rejects non-integer allocation values', async () => {
  const response = await handleSubmitAllocation(
    { aave: 12.5 },
    unusedPowers,
  );

  assert.strictEqual(
    response.content[0].text,
    'allocation for aave must be an integer percentage',
  );
});

test('handleSubmitAllocation rejects non-finite allocation values', async () => {
  const response = await handleSubmitAllocation(
    { aave: Number.NaN },
    unusedPowers,
  );

  assert.strictEqual(
    response.content[0].text,
    'allocation for aave must be a finite number',
  );
});
