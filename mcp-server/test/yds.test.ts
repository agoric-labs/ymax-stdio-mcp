import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTargetBalances,
  handleSimulateTargetAllocation,
  SIMULATE_TARGET_ALLOCATION_TOOL,
  type ComputeTargetBalancesRequest,
  type ComputeTargetBalancesResponse,
} from '../src/yds.ts';

const request: ComputeTargetBalancesRequest = {
  denom: 'USDC',
  currentAmounts: {
    Aave_Arbitrum: '800000',
    Compound_Arbitrum: '400000',
  },
  targetAllocation: {
    Aave_Arbitrum: '40',
    Compound_Arbitrum: '60',
  },
  action: { type: 'rebalance' },
};

const result: ComputeTargetBalancesResponse = {
  message: 'Target balances computed successfully',
  denom: 'USDC',
  data: { Aave_Arbitrum: '480000', Compound_Arbitrum: '720000' },
  affectedPlaceCount: 2,
  timestamp: '2026-08-12T00:00:00.000Z',
};

const options = (fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = {}) => ({
  env,
  fetch: fetchImpl,
});

test('computeTargetBalances invokes the YDS planning endpoint', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetchMock = async (url: string, requestOptions: RequestInit) => {
    calls.push({ url, options: requestOptions });
    return Response.json(result);
  };

  const actual = await computeTargetBalances(
    request,
    options(fetchMock as typeof fetch),
  );

  assert.deepStrictEqual(actual, result);
  assert.strictEqual(
    calls[0].url,
    'https://main1.ymax.app/plan/computeTargetBalances',
  );
  assert.strictEqual(calls[0].options.method, 'POST');
  assert.deepStrictEqual(calls[0].options.headers, {
    'Content-Type': 'application/json',
  });
  assert.deepStrictEqual(JSON.parse(calls[0].options.body as string), request);
});

test('computeTargetBalances follows the selected YMax instance', async () => {
  const urls: string[] = [];
  const fetchMock = async (url: string) => {
    urls.push(url);
    return Response.json(result);
  };

  await computeTargetBalances(request, {
    ...options(fetchMock as typeof fetch),
    ymaxInstance: 'ymax0',
  });

  assert.deepStrictEqual(urls, [
    'https://main0.ymax.app/plan/computeTargetBalances',
  ]);
});

test('computeTargetBalances honors YDS_URL', async () => {
  const urls: string[] = [];
  const fetchMock = async (url: string) => {
    urls.push(url);
    return Response.json(result);
  };

  await computeTargetBalances(
    request,
    options(fetchMock as typeof fetch, { YDS_URL: 'https://yds.example' }),
  );

  assert.deepStrictEqual(urls, [
    'https://yds.example/plan/computeTargetBalances',
  ]);
});

test('computeTargetBalances normalizes a trailing slash in YDS_URL', async () => {
  const urls: string[] = [];
  const fetchMock = async (url: string) => {
    urls.push(url);
    return Response.json(result);
  };

  await computeTargetBalances(
    request,
    options(fetchMock as typeof fetch, { YDS_URL: 'https://yds.example/' }),
  );

  assert.deepStrictEqual(urls, [
    'https://yds.example/plan/computeTargetBalances',
  ]);
});

test('computeTargetBalances surfaces a YDS rejection body', async () => {
  const fetchMock = async () =>
    new Response('{"error":"invalid target allocation"}', { status: 400 });

  await assert.rejects(
    () =>
      computeTargetBalances(request, options(fetchMock as typeof fetch)),
    {
      message:
        /Computing target balances failed \(400\): .*invalid target allocation/,
    },
  );
});

test('simulation tool publishes typed read-only metadata', () => {
  assert.strictEqual(
    SIMULATE_TARGET_ALLOCATION_TOOL.name,
    'simulate_target_allocation',
  );
  assert.strictEqual(
    SIMULATE_TARGET_ALLOCATION_TOOL.annotations?.readOnlyHint,
    true,
  );
  assert.strictEqual(
    SIMULATE_TARGET_ALLOCATION_TOOL.annotations?.destructiveHint,
    false,
  );
  assert.deepStrictEqual(SIMULATE_TARGET_ALLOCATION_TOOL.inputSchema.required, [
    'denom',
    'currentAmounts',
    'targetAllocation',
    'action',
  ]);
  assert.deepStrictEqual(SIMULATE_TARGET_ALLOCATION_TOOL.outputSchema?.required, [
    'message',
    'denom',
    'data',
    'affectedPlaceCount',
    'timestamp',
  ]);
});

test('simulation handler returns typed structured content and readable text', async () => {
  const fetchMock = async () => Response.json(result);

  const response = await handleSimulateTargetAllocation(
    request,
    options(fetchMock as typeof fetch),
  );

  assert.deepStrictEqual(response.structuredContent, result);
  assert.deepStrictEqual(JSON.parse(response.content[0].text), result);
  assert.strictEqual(response.isError, undefined);
});
