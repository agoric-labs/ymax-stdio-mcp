import '@endo/init';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  handleSubmitAllocation,
  type SubmitAllocationOptions,
} from '../../src/handlers/submit-allocation.ts';
import { makeStateStore, type StateStore } from '../../src/state.ts';
import type { DelegateState } from '../../src/types.ts';

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

const submitHarness = (
  activeDelegate: DelegateState,
  tx: { code: number; rawLog?: string; transactionHash: string },
  invocationError?: string,
) => {
  const observed: Record<string, unknown> = {};
  const stateStore: StateStore = {
    createActiveDelegate: () => 'unused',
    getActiveDelegate: () => activeDelegate,
    updateActiveDelegate: () => false,
  };
  const options: SubmitAllocationOptions = {
    env: {},
    fetch: unusedPowers.fetch,
    setTimeout,
    now: unusedPowers.now,
    stateStore,
    fetchEnvNetworkConfig: (async () => ({
      chainName: 'agoric-3',
    })) as NonNullable<SubmitAllocationOptions['fetchEnvNetworkConfig']>,
    makeSmartWalletKit: (async () => ({
      readPublished: async (path: string) => {
        observed.publishedPath = path;
        return { policyVersion: 6, rebalanceCount: 2 };
      },
    })) as NonNullable<SubmitAllocationOptions['makeSmartWalletKit']>,
    makeDelegateSigningKit: (async (_walletKit, delegate) => {
      observed.signingDelegate = delegate;
      return { query: { getLastUpdate: async () => undefined } };
    }) as NonNullable<SubmitAllocationOptions['makeDelegateSigningKit']>,
    reflectWalletStore: (() => ({
      get: () => ({
        setTargetAllocation: async (input: unknown) => {
          observed.input = input;
          return { id: invocationError ? 'flow-test' : undefined, tx };
        },
      }),
    })) as NonNullable<SubmitAllocationOptions['reflectWalletStore']>,
    attemptRegistration: (async params => {
      observed.registration = params;
      return { registered: true };
    }) as NonNullable<SubmitAllocationOptions['attemptRegistration']>,
    getInvocationUpdate: (async () => {
      if (invocationError) throw new Error(invocationError);
      return undefined;
    }) as NonNullable<SubmitAllocationOptions['getInvocationUpdate']>,
  };
  return { observed, options };
};

test('handleSubmitAllocation carries ymax1 and HD path through submission', async () => {
  const activeDelegate: DelegateState = {
    mnemonic: 'test mnemonic',
    address: 'agoric1delegate',
    hdPath: "m/44'/118'/0'/0/0",
    ymaxInstance: 'ymax1',
    portfolioId: 42,
    delegationKeyName: 'delegate-portfolio42',
  };
  const { observed, options } = submitHarness(activeDelegate, {
    code: 0,
    transactionHash: 'SUCCESS_TX',
  });

  const response = await handleSubmitAllocation({ Aave_Base: 100 }, options);

  assert.strictEqual(
    observed.publishedPath,
    'ymax1.portfolios.portfolio42',
  );
  assert.strictEqual(observed.signingDelegate, activeDelegate);
  assert.deepStrictEqual(observed.input, {
    targetAllocation: { Aave_Base: 100n },
    syncState: { policyVersion: 6, rebalanceCount: 2 },
  });
  assert.deepStrictEqual(observed.registration, {
    txHash: 'SUCCESS_TX',
    chain: 'agoric-3',
    ymaxInstance: 'ymax1',
  });
  assert.deepStrictEqual(JSON.parse(response.content[0].text), {
    status: 'submitted',
    txHash: 'SUCCESS_TX',
    ymaxInstance: 'ymax1',
    policyVersion: 6,
    registered: true,
  });
});

test('handleSubmitAllocation binds legacy rejection to ymax0', async () => {
  const { observed, options } = submitHarness(
    {
      mnemonic: 'legacy mnemonic',
      address: 'agoric1legacy',
      portfolioId: 7,
      delegationKeyName: 'delegate-portfolio7',
    },
    { code: 5, rawLog: 'unauthorized', transactionHash: 'REJECTED_TX' },
  );

  const response = await handleSubmitAllocation({ Compound_Base: 100 }, options);

  assert.strictEqual(observed.publishedPath, 'ymax0.portfolios.portfolio7');
  assert.deepStrictEqual(observed.registration, {
    txHash: 'REJECTED_TX',
    chain: 'agoric-3',
    ymaxInstance: 'ymax0',
  });
  assert.deepStrictEqual(JSON.parse(response.content[0].text), {
    status: 'rejected',
    txHash: 'REJECTED_TX',
    ymaxInstance: 'ymax0',
    policyVersion: 6,
    error: 'invokeEntry failed (5): unauthorized',
    registered: true,
  });
  assert.strictEqual(response.isError, true);
});

test('handleSubmitAllocation reports asynchronous ymax1 rejection', async () => {
  const { options } = submitHarness(
    {
      mnemonic: 'test mnemonic',
      address: 'agoric1delegate',
      ymaxInstance: 'ymax1',
      portfolioId: 42,
      delegationKeyName: 'delegate-portfolio42',
    },
    { code: 0, transactionHash: 'ASYNC_REJECTED_TX' },
    'unauthorized allocations',
  );

  const response = await handleSubmitAllocation({ Aave_Base: 100 }, options);

  assert.deepStrictEqual(JSON.parse(response.content[0].text), {
    status: 'rejected',
    txHash: 'ASYNC_REJECTED_TX',
    ymaxInstance: 'ymax1',
    policyVersion: 6,
    error: 'unauthorized allocations',
    registered: true,
  });
  assert.strictEqual(response.isError, true);
});
