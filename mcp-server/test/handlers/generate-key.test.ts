import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleGenerateKey } from '../../src/handlers/generate-key.ts';
import { makeStateStore } from '../../src/state.ts';

function testStore() {
  return makeStateStore(
    join(tmpdir(), `ymax-mcp-generate-test-${crypto.randomUUID()}.json`),
  );
}

test('handleGenerateKey refuses to replace active delegate without clobber', async () => {
  const stateStore = testStore();
  stateStore.createActiveDelegate('mnemonic', 'addr');

  await assert.rejects(
    () =>
      handleGenerateKey(false, {
        env: {},
        stateStore,
      }),
    /active delegate already exists; pass clobberActiveDelegate=true to replace it/,
  );
});
