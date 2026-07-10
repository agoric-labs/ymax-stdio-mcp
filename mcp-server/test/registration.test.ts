import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTransaction } from '../src/registration.ts';

const YDS_URL = 'https://main0.ymax.app';

test('registerTransaction calls fetch with correct URL and method', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls: { url: string; options: RequestInit }[] = [];
    globalThis.fetch = async (
      url: string,
      options: RequestInit,
    ) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await registerTransaction({
      txHash: 'ABC123',
      portfolioId: 84,
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, `${YDS_URL}/transactions`);
    assert.strictEqual(calls[0].options.method, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registerTransaction sends txHash and portfolioId in body', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const bodies: string[] = [];
    globalThis.fetch = async (
      _url: string,
      options: RequestInit,
    ) => {
      bodies.push(options.body as string);
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await registerTransaction({
      txHash: 'ABC123',
      portfolioId: 84,
    });

    const parsed = JSON.parse(bodies[0]);
    assert.strictEqual(parsed.txHash, 'ABC123');
    assert.strictEqual(parsed.portfolioId, 84);
    assert.strictEqual(parsed.flowKey, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registerTransaction includes flowKey when provided', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const bodies: string[] = [];
    globalThis.fetch = async (
      _url: string,
      options: RequestInit,
    ) => {
      bodies.push(options.body as string);
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await registerTransaction({
      txHash: 'ABC123',
      portfolioId: 84,
      flowKey: 'flow6',
    });

    const parsed = JSON.parse(bodies[0]);
    assert.strictEqual(parsed.flowKey, 'flow6');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registerTransaction returns success on 200', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), { status: 200 });

    const result = await registerTransaction({
      txHash: 'ABC123',
      portfolioId: 84,
    });

    assert.deepStrictEqual(result, { success: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registerTransaction throws on HTTP error', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response('not found', { status: 404 });

    await assert.rejects(
      () =>
        registerTransaction({
          txHash: 'ABC123',
          portfolioId: 84,
        }),
      {
        message: /Transaction registration failed \(404\)/,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registerTransaction sends Content-Type header', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const headers: Record<string, string>[] = [];
    globalThis.fetch = async (
      _url: string,
      options: RequestInit,
    ) => {
      headers.push(options.headers as Record<string, string>);
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await registerTransaction({
      txHash: 'ABC123',
      portfolioId: 84,
    });

    assert.strictEqual(headers[0]['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registerTransaction handles empty error body', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(null, { status: 500, statusText: 'Internal Server Error' });

    await assert.rejects(
      () =>
        registerTransaction({
          txHash: 'ABC123',
          portfolioId: 84,
        }),
      {
        message: /Transaction registration failed \(500\)/,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
