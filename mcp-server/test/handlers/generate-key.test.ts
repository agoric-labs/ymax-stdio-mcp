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
  stateStore.createActiveDelegate('mnemonic', 'addr', 'ymax1');

  await assert.rejects(
    () =>
      handleGenerateKey(false, {
        env: {},
        stateStore,
      }),
    /active delegate already exists; pass clobberActiveDelegate=true to replace it/,
  );
});

test('handleGenerateKey persists the instance and HD path', async () => {
  const stateStore = testStore();
  const result = await handleGenerateKey(
    false,
    {
      env: {},
      stateStore,
      generateDelegate: async () => ({
        mnemonic: 'test mnemonic',
        address: 'agoric1delegate',
      }),
      fundDelegate: async address => {
        assert.strictEqual(address, 'agoric1delegate');
        return { txHash: 'SPONSOR_TX', amount: '20000000' };
      },
      provisionWallet: async (mnemonic, address) => {
        assert.strictEqual(mnemonic, 'test mnemonic');
        assert.strictEqual(address, 'agoric1delegate');
        return { txHash: 'PROVISION_TX' };
      },
    },
    'ymax1',
  );

  assert.deepStrictEqual(result, {
    address: 'agoric1delegate',
    ymaxInstance: 'ymax1',
    sponsorTx: 'SPONSOR_TX',
    provisionTx: 'PROVISION_TX',
  });
  assert.deepStrictEqual(stateStore.getActiveDelegate(), {
    mnemonic: 'test mnemonic',
    address: 'agoric1delegate',
    ymaxInstance: 'ymax1',
    hdPath: "m/44'/564'/0'/0/0",
  });
});
