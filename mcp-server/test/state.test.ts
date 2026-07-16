import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';

const testStateFile = `/tmp/ymax-mcp-state-test-${process.pid}.json`;
process.env.YMAX_STATE_FILE = testStateFile;

const { getSession, setSession, updateSession } = await import(
  '../src/state.ts'
);

after(() => {
  try {
    unlinkSync(testStateFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
});

test('setSession stores the server delegate state', () => {
  setSession('test mnemonic', 'agoric1abc');

  assert.deepStrictEqual(getSession(), {
    mnemonic: 'test mnemonic',
    address: 'agoric1abc',
  });
});

test('setSession replaces prior delegate state', () => {
  setSession('mnemonic-1', 'addr-1');
  setSession('mnemonic-2', 'addr-2');

  assert.deepStrictEqual(getSession(), {
    mnemonic: 'mnemonic-2',
    address: 'addr-2',
  });
});

test('updateSession adds portfolio binding', () => {
  setSession('mnemonic', 'addr');
  updateSession({
    portfolioId: 84,
    delegationKeyName: 'delegate-portfolio84',
  });

  assert.deepStrictEqual(getSession(), {
    mnemonic: 'mnemonic',
    address: 'addr',
    portfolioId: 84,
    delegationKeyName: 'delegate-portfolio84',
  });
});
