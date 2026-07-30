import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attemptRegistration,
  registerTransaction,
} from '../src/registration.ts';

const YDS_URL = 'https://main0.ymax.app';

const options = (fetchImpl: typeof fetch) => ({
  env: {},
  fetch: fetchImpl,
});

const params = {
  txHash: 'ABC123',
  chain: 'agoric-3',
  ymaxInstance: 'ymax0',
};

test('registerTransaction calls fetch with correct URL and method', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetchMock = async (url: string, requestOptions: RequestInit) => {
    calls.push({ url, options: requestOptions });
    return new Response(JSON.stringify({}), { status: 202 });
  };

  await registerTransaction(params, options(fetchMock as typeof fetch));

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, `${YDS_URL}/transactions`);
  assert.strictEqual(calls[0].options.method, 'POST');
});

test('registerTransaction sends every field POST /transactions requires', async () => {
  const bodies: string[] = [];
  const fetchMock = async (_url: string, requestOptions: RequestInit) => {
    bodies.push(requestOptions.body as string);
    return new Response(JSON.stringify({}), { status: 202 });
  };

  await registerTransaction(params, options(fetchMock as typeof fetch));

  const parsed = JSON.parse(bodies[0]);
  assert.deepStrictEqual(parsed, {
    txHash: 'ABC123',
    chain: 'agoric-3',
    ymaxInstance: 'ymax0',
  });
});

test('registerTransaction omits portfolioId, which YDS rejects as unknown', async () => {
  const bodies: string[] = [];
  const fetchMock = async (_url: string, requestOptions: RequestInit) => {
    bodies.push(requestOptions.body as string);
    return new Response(JSON.stringify({}), { status: 202 });
  };

  await registerTransaction(
    { ...params, portfolioId: 95 } as any,
    options(fetchMock as typeof fetch),
  );

  const parsed = JSON.parse(bodies[0]);
  assert.strictEqual(parsed.portfolioId, undefined);
});

test('registerTransaction does not publish an unavailable flowKey', async () => {
  const bodies: string[] = [];
  const fetchMock = async (_url: string, requestOptions: RequestInit) => {
    bodies.push(requestOptions.body as string);
    return new Response(JSON.stringify({}), { status: 202 });
  };

  await registerTransaction(
    { ...params, flowKey: 'flow6' } as any,
    options(fetchMock as typeof fetch),
  );

  const parsed = JSON.parse(bodies[0]);
  assert.strictEqual(parsed.flowKey, undefined);
});

test('registerTransaction treats 202 Accepted as success', async () => {
  const fetchMock = async () =>
    new Response(JSON.stringify({ message: 'Transaction accepted' }), {
      status: 202,
    });

  const result = await registerTransaction(
    params,
    options(fetchMock as typeof fetch),
  );

  assert.deepStrictEqual(result, { success: true });
});

test('registerTransaction returns success on 200', async () => {
  const fetchMock = async () =>
    new Response(JSON.stringify({}), { status: 200 });

  const result = await registerTransaction(
    params,
    options(fetchMock as typeof fetch),
  );

  assert.deepStrictEqual(result, { success: true });
});

test('registerTransaction surfaces a schema rejection body', async () => {
  const fetchMock = async () =>
    new Response('{"error":{"name":"ZodError"}}', { status: 400 });

  await assert.rejects(
    () => registerTransaction(params, options(fetchMock as typeof fetch)),
    {
      message: /Transaction registration failed \(400\): .*ZodError/,
    },
  );
});

test('registerTransaction throws on HTTP error', async () => {
  const fetchMock = async () => new Response('not found', { status: 404 });

  await assert.rejects(
    () => registerTransaction(params, options(fetchMock as typeof fetch)),
    {
      message: /Transaction registration failed \(404\)/,
    },
  );
});

test('registerTransaction sends Content-Type header', async () => {
  const headers: Record<string, string>[] = [];
  const fetchMock = async (_url: string, requestOptions: RequestInit) => {
    headers.push(requestOptions.headers as Record<string, string>);
    return new Response(JSON.stringify({}), { status: 202 });
  };

  await registerTransaction(params, options(fetchMock as typeof fetch));

  assert.strictEqual(headers[0]['Content-Type'], 'application/json');
});

test('attemptRegistration reports success without throwing', async () => {
  const fetchMock = async () =>
    new Response(JSON.stringify({}), { status: 202 });

  assert.deepStrictEqual(
    await attemptRegistration(params, options(fetchMock as typeof fetch)),
    { registered: true },
  );
});

test('attemptRegistration captures failure instead of throwing', async () => {
  const fetchMock = async () =>
    new Response('{"error":{"name":"ZodError"}}', { status: 400 });

  const result = await attemptRegistration(
    params,
    options(fetchMock as typeof fetch),
  );

  assert.strictEqual(result.registered, false);
  assert.match(
    (result as { registrationError: string }).registrationError,
    /Transaction registration failed \(400\)/,
  );
});

test('attemptRegistration captures a network failure', async () => {
  const fetchMock = async () => {
    throw new Error('fetch failed');
  };

  const result = await attemptRegistration(
    params,
    options(fetchMock as typeof fetch),
  );

  assert.deepStrictEqual(result, {
    registered: false,
    registrationError: 'fetch failed',
  });
});

test('registerTransaction handles empty error body', async () => {
  const fetchMock = async () =>
    new Response(null, { status: 500, statusText: 'Internal Server Error' });

  await assert.rejects(
    () => registerTransaction(params, options(fetchMock as typeof fetch)),
    {
      message: /Transaction registration failed \(500\)/,
    },
  );
});
