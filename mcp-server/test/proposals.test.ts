import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateProposalUrl,
  buildEditProposalUrl,
  buildGrantProposalUrl,
} from '../src/proposals.ts';

const UI_URL = 'https://staging-agentic-ui.ymax0-ui.pages.dev';

test('create proposal combines allocations and delegation', () => {
  const url = new URL(
    buildCreateProposalUrl(
      UI_URL,
      {
        Aave_Arbitrum: 60,
        Compound_Arbitrum: 40,
      },
      'agoric1delegate',
    ),
  );

  assert.strictEqual(url.pathname, '/create-portfolio');
  assert.strictEqual(url.searchParams.get('Aave_Arbitrum'), '60');
  assert.strictEqual(url.searchParams.get('Compound_Arbitrum'), '40');
  assert.strictEqual(url.searchParams.get('accountHolder'), 'agoric1delegate');
  assert.strictEqual(url.searchParams.get('permissions'), 'change-allocations');
});

test('grant proposal delegates an existing portfolio', () => {
  const url = new URL(
    buildGrantProposalUrl(UI_URL, 'agoric1delegate'),
  );

  assert.strictEqual(url.pathname, '/grant');
  assert.strictEqual(url.searchParams.get('accountHolder'), 'agoric1delegate');
  assert.strictEqual(url.searchParams.has('permissions'), false);
});

test('proposal links preserve experimental values without validation', () => {
  const url = new URL(
    buildEditProposalUrl(UI_URL, {
      Unknown_Instrument: -25,
      Aave_Arbitrum: 175,
      'odd instrument/key': 0.5,
      Compound_Arbitrum: 'foo',
    }),
  );

  assert.strictEqual(url.pathname, '/edit-portfolio');
  assert.strictEqual(url.searchParams.get('Unknown_Instrument'), '-25');
  assert.strictEqual(url.searchParams.get('Aave_Arbitrum'), '175');
  assert.strictEqual(url.searchParams.get('odd instrument/key'), '0.5');
  assert.strictEqual(url.searchParams.get('Compound_Arbitrum'), 'foo');
});

test('create proposal reserves delegation parameters', () => {
  const url = new URL(
    buildCreateProposalUrl(
      UI_URL,
      { accountHolder: 12, permissions: 34 },
      'agoric1delegate',
    ),
  );

  assert.deepStrictEqual(url.searchParams.getAll('accountHolder'), [
    'agoric1delegate',
  ]);
  assert.deepStrictEqual(url.searchParams.getAll('permissions'), [
    'change-allocations',
  ]);
});
