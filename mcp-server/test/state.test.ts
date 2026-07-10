import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeStateStore, hasPortfolioId } from '../src/state.ts';

function testFile() {
  return join(tmpdir(), `ymax-mcp-state-test-${crypto.randomUUID()}.json`);
}

test('createActiveDelegate sets the active delegate', () => {
  const store = makeStateStore(testFile());
  const delegateId = store.createActiveDelegate('test mnemonic', 'agoric1abc');

  assert.strictEqual(typeof delegateId, 'string');
  assert.ok(delegateId.length > 0);

  const activeDelegate = store.getActiveDelegate();
  assert.ok(activeDelegate);
  assert.strictEqual(activeDelegate.mnemonic, 'test mnemonic');
  assert.strictEqual(activeDelegate.address, 'agoric1abc');
  assert.strictEqual(activeDelegate.portfolioId, undefined);
  assert.strictEqual(activeDelegate.delegationKeyName, undefined);
});

test('createActiveDelegate replaces the active delegate', () => {
  const store = makeStateStore(testFile());
  store.createActiveDelegate('mnemonic-1', 'addr-1');
  store.createActiveDelegate('mnemonic-2', 'addr-2');

  const activeDelegate = store.getActiveDelegate();
  assert.ok(activeDelegate);
  assert.strictEqual(activeDelegate.mnemonic, 'mnemonic-2');
  assert.strictEqual(activeDelegate.address, 'addr-2');
});

test('getActiveDelegate returns undefined before delegate creation', () => {
  const store = makeStateStore(testFile());
  assert.strictEqual(store.getActiveDelegate(), undefined);
});

test('updateActiveDelegate updates active delegate fields', () => {
  const store = makeStateStore(testFile());
  store.createActiveDelegate('mnemonic', 'addr');

  const updated = store.updateActiveDelegate({
    portfolioId: 84,
    delegationKeyName: 'delegate-portfolio84',
  });
  assert.strictEqual(updated, true);

  const activeDelegate = store.getActiveDelegate();
  assert.ok(activeDelegate);
  assert.strictEqual(activeDelegate.portfolioId, 84);
  assert.strictEqual(activeDelegate.delegationKeyName, 'delegate-portfolio84');
});

test('updateActiveDelegate returns false without an active delegate', () => {
  const store = makeStateStore(testFile());
  assert.strictEqual(store.updateActiveDelegate({ portfolioId: 84 }), false);
});

test('state persists active delegate by path', () => {
  const file = testFile();
  const firstStore = makeStateStore(file);
  firstStore.createActiveDelegate('mnemonic', 'addr');
  firstStore.updateActiveDelegate({ portfolioId: 84 });

  const secondStore = makeStateStore(file);
  const activeDelegate = secondStore.getActiveDelegate();
  assert.ok(activeDelegate);
  assert.strictEqual(activeDelegate.mnemonic, 'mnemonic');
  assert.strictEqual(activeDelegate.address, 'addr');
  assert.strictEqual(activeDelegate.portfolioId, 84);
});

test('portfolio zero is a valid portfolio binding', () => {
  assert.strictEqual(
    hasPortfolioId({ mnemonic: 'mnemonic', address: 'addr', portfolioId: 0 }),
    true,
  );
});
