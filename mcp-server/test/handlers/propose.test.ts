import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleProposeCreate,
  handleProposeGrant,
} from '../../src/handlers/propose.ts';
import type { DelegateState } from '../../src/types.ts';

const stateWith = (delegate: DelegateState) => ({
  getActiveDelegate: () => delegate,
});

test('new ymax1 onboarding proposes through the staging agentic UI', async () => {
  const response = await handleProposeCreate(
    { Aave_Base: 100 },
    stateWith({
      mnemonic: 'mnemonic',
      address: 'agoric1delegate',
      ymaxInstance: 'ymax1',
    }),
    undefined,
  );
  const result = JSON.parse(response.content[0].text);

  assert.strictEqual(result.ymaxInstance, 'ymax1');
  assert.strictEqual(
    new URL(result.url).origin,
    'https://staging-agentic-ui.ymax1-ui.pages.dev',
  );
});

test('ymax0 onboarding remains available', async () => {
  const response = await handleProposeGrant(
    stateWith({
      mnemonic: 'mnemonic',
      address: 'agoric1delegate',
      ymaxInstance: 'ymax0',
    }),
    undefined,
  );
  const result = JSON.parse(response.content[0].text);

  assert.strictEqual(result.ymaxInstance, 'ymax0');
  assert.strictEqual(
    new URL(result.url).origin,
    'https://staging-agentic-ui.ymax0-ui.pages.dev',
  );
});
