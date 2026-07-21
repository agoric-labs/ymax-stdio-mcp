import test from 'node:test';
import assert from 'node:assert/strict';
import { main, getPinchtabConfig } from './smoke.ts';

const response = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const makeStat = (size = 12) =>
  ({
    isFile: () => true,
    size,
  });

const noConfigFiles = {
  join: () => ({
    readJSON: async () => {
      throw Error('ambient config read should not happen');
    },
  }),
} as any;

test('config rejects webp recordings explicitly', async () => {
  await assert.rejects(
    () =>
      getPinchtabConfig(
        {
          PINCHTAB_TOKEN: 'secret',
          PINCHTAB_RECORDING_FORMAT: 'webp',
        },
        noConfigFiles,
      ),
    /Unsupported PINCHTAB_RECORDING_FORMAT=webp/,
  );
});

test('config uses injected token without reading config', async () => {
  const config = await getPinchtabConfig(
    { PINCHTAB_TOKEN: 'secret' },
    noConfigFiles,
  );
  assert.strictEqual(config.token, 'secret');
});

test('config loads token from the PinchTab config candidates', async () => {
  const config = await getPinchtabConfig(
    { HOME: '/operator' },
    {
      join: (...segments: string[]) => ({
        readJSON: async () => {
          assert.deepStrictEqual(segments, [
            '/operator/.config',
            'pinchtab',
            'config.json',
          ]);
          return { server: { token: 'from-config' } };
        },
      }),
    } as any,
  );
  assert.strictEqual(config.token, 'from-config');
});

test('smoke reuses a running profile and converts gif to webm', async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const execCalls: { file: string; args: string[] }[] = [];
  const writes: Record<string, string> = {};

  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    urls.push(href);
    if (init?.body) {
      bodies.push(JSON.parse(init.body as string));
    }
    assert.strictEqual(
      (init?.headers as Record<string, string> | undefined)?.Authorization,
      'Bearer test-token',
    );

    if (href.endsWith('/health')) return response({});
    if (href.endsWith('/profiles')) {
      return response([{ id: 'prof_1', name: 'ymax-flow1', path: '/tmp/profile' }]);
    }
    if (href.endsWith('/profiles/prof_1/start')) return response('already running', 409);
    if (href.endsWith('/profiles/prof_1/instance')) return response({ port: 9870 });
    if (href.endsWith('/navigate')) return response({ ok: true });
    if (href.endsWith('/record/start')) return response({});
    if (href.endsWith('/snapshot?filter=interactive')) return response([{ ref: 'e1' }]);
    if (href.endsWith('/record/stop')) {
      return response({ path: '/tmp/profile/.pinchtab-state/recordings/rec.gif' });
    }
    if (href.endsWith('/record/status')) {
      return response({
        state: 'finished',
        outputPath: '/tmp/profile/.pinchtab-state/recordings/rec.gif',
      });
    }
    throw Error(`unexpected URL: ${href}`);
  };

  const result = await main(
    {
      PINCHTAB_TOKEN: 'test-token',
      PINCHTAB_RECORDING_FORMAT: 'webm',
      PINCHTAB_ARTIFACT_DIR: '/tmp/artifacts',
      PINCHTAB_FFMPEG_BIN: '/usr/bin/ffmpeg',
    },
    {
      fetch: fetch as typeof globalThis.fetch,
      fspP: Promise.resolve({
        readFile: async () => '',
        writeFile: async (path: unknown, data: unknown) => {
          writes[String(path)] = String(data);
        },
        mkdir: async () => undefined,
        stat: async () => makeStat(),
      } as any),
      delay: async () => undefined,
      execFile: (async (file: string, args: string[]) => {
        execCalls.push({ file, args });
        return { stdout: '', stderr: '' };
      }) as any,
    },
  );

  assert.deepStrictEqual(result, {
    recordingPath: '/tmp/profile/.pinchtab-state/recordings/rec.webm',
    intermediateGifPath: '/tmp/profile/.pinchtab-state/recordings/rec.gif',
  });
  assert.ok(urls.includes('http://127.0.0.1:9867/profiles/prof_1/instance'));
  assert.deepStrictEqual(bodies.find(body => (body as { format?: string }).format), {
    format: 'gif',
    fps: 5,
    quality: 70,
    scale: 1,
  });
  assert.deepStrictEqual(execCalls, [
    {
      file: '/usr/bin/ffmpeg',
      args: [
        '-y',
        '-v',
        'error',
        '-i',
        '/tmp/profile/.pinchtab-state/recordings/rec.gif',
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        '/tmp/profile/.pinchtab-state/recordings/rec.webm',
      ],
    },
  ]);
  assert.match(writes['/tmp/artifacts/pinchtab-smoke-navigation.json'], /"ok": true/);
});
