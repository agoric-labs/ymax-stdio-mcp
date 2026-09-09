import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_HD_PATH, delegateHdPath } from '../src/hd-path.ts';
import { makeStateStore } from '../src/state.ts';

function testFile() {
  return join(tmpdir(), `ymax-mcp-hdpath-test-${crypto.randomUUID()}.json`);
}

test('delegateHdPath defaults to the Agoric coin type', () => {
  assert.strictEqual(
    delegateHdPath({ mnemonic: 'm', address: 'agoric1abc' }),
    "m/44'/564'/0'/0/0",
  );
});

test('delegateHdPath honors a recorded hdPath', () => {
  assert.strictEqual(
    delegateHdPath({
      mnemonic: 'm',
      address: 'agoric1abc',
      hdPath: "m/44'/118'/0'/0/0",
    }),
    "m/44'/118'/0'/0/0",
  );
});

test('createActiveDelegate records the derivation path it was given', () => {
  const file = testFile();
  const store = makeStateStore(file);
  store.createActiveDelegate('test mnemonic', 'agoric1abc', DEFAULT_HD_PATH);

  const reloaded = makeStateStore(file).getActiveDelegate();
  assert.ok(reloaded);
  assert.strictEqual(reloaded.hdPath, DEFAULT_HD_PATH);
});

test('a delegate saved without a path still resolves to the default', () => {
  const file = testFile();
  const store = makeStateStore(file);
  store.createActiveDelegate('test mnemonic', 'agoric1abc');

  const reloaded = makeStateStore(file).getActiveDelegate();
  assert.ok(reloaded);
  assert.strictEqual(reloaded.hdPath, undefined);
  assert.strictEqual(delegateHdPath(reloaded), DEFAULT_HD_PATH);
});
