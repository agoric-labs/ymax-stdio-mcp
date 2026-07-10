import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTransaction } from '../src/registration.ts';

const YDS_URL = 'https://main0.ymax.app';

const options = (fetchImpl: typeof fetch) => ({
  env: {},
  fetch: fetchImpl,
});

test('registerTransaction calls fetch with correct URL and method', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetchMock = async (url: string, requestOptions: RequestInit) => {
    calls.push({ url, options: requestOptions });
    return new Response(JSON.stringify({}), { status: 200 });
  };

  await registerTransaction(
    {
      txHash: 'ABC123',
      portfolioId: 84,
    },
    options(fetchMock as typeof fetch),
  );

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, `${YDS_URL}/transactions`);
  assert.strictEqual(calls[0].options.method, 'POST');
});

test('registerTransaction sends txHash and portfolioId in body', async () => {
  const bodies: string[] = [];
  const fetchMock = async (_url: string, requestOptions: RequestInit) => {
    bodies.push(requestOptions.body as string);
    return new Response(JSON.stringify({}), { status: 200 });
  };

  await registerTransaction(
    {
      txHash: 'ABC123',
      portfolioId: 84,
    },
    options(fetchMock as typeof fetch),
  );

  const parsed = JSON.parse(bodies[0]);
  assert.strictEqual(parsed.txHash, 'ABC123');
  assert.strictEqual(parsed.portfolioId, 84);
  assert.strictEqual(parsed.flowKey, undefined);
});

test('registerTransaction includes flowKey when provided', async () => {
  const bodies: string[] = [];
  const fetchMock = async (_url: string, requestOptions: RequestInit) => {
    bodies.push(requestOptions.body as string);
    return new Response(JSON.stringify({}), { status: 200 });
  };

  await registerTransaction(
    {
      txHash: 'ABC123',
      portfolioId: 84,
      flowKey: 'flow6',
    },
    options(fetchMock as typeof fetch),
  );

  const parsed = JSON.parse(bodies[0]);
  assert.strictEqual(parsed.flowKey, 'flow6');
});

test('registerTransaction returns success on 200', async () => {
  const fetchMock = async () =>
    new Response(JSON.stringify({}), { status: 200 });

  const result = await registerTransaction(
    {
      txHash: 'ABC123',
      portfolioId: 84,
    },
    options(fetchMock as typeof fetch),
  );

  assert.deepStrictEqual(result, { success: true });
});

test('registerTransaction throws on HTTP error', async () => {
  const fetchMock = async () =>
    new Response('not found', { status: 404 });

  await assert.rejects(
    () =>
      registerTransaction(
        {
          txHash: 'ABC123',
          portfolioId: 84,
        },
        options(fetchMock as typeof fetch),
      ),
    {
      message: /Transaction registration failed \(404\)/,
    },
  );
});

test('registerTransaction sends Content-Type header', async () => {
  const headers: Record<string, string>[] = [];
  const fetchMock = async (_url: string, requestOptions: RequestInit) => {
    headers.push(requestOptions.headers as Record<string, string>);
    return new Response(JSON.stringify({}), { status: 200 });
  };

  await registerTransaction(
    {
      txHash: 'ABC123',
      portfolioId: 84,
    },
    options(fetchMock as typeof fetch),
  );

  assert.strictEqual(headers[0]['Content-Type'], 'application/json');
});

test('registerTransaction handles empty error body', async () => {
  const fetchMock = async () =>
    new Response(null, { status: 500, statusText: 'Internal Server Error' });

  await assert.rejects(
    () =>
      registerTransaction(
        {
          txHash: 'ABC123',
          portfolioId: 84,
        },
        options(fetchMock as typeof fetch),
      ),
    {
      message: /Transaction registration failed \(500\)/,
    },
  );
});
