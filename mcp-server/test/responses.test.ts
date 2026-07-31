import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registrationOutcome,
  submissionRejected,
  toolError,
} from '../src/responses.ts';

test('tool errors are marked as MCP errors', () => {
  assert.deepStrictEqual(toolError('no portfolio state'), {
    content: [{ type: 'text', text: 'no portfolio state' }],
    isError: true,
  });
});

const rejected = {
  txHash: 'F48D5F3C',
  policyVersion: 6,
  error: 'unauthorized allocations for ["Aave_Ethereum"]',
};

test('submissionRejected keeps the txHash of a rejected submission', () => {
  const response = submissionRejected(rejected, { registered: true });

  assert.strictEqual(response.isError, true);
  assert.deepStrictEqual(JSON.parse(response.content[0].text), {
    status: 'rejected',
    txHash: 'F48D5F3C',
    policyVersion: 6,
    error: 'unauthorized allocations for ["Aave_Ethereum"]',
    registered: true,
  });
});

test('submissionRejected reports a registration failure alongside the rejection', () => {
  const response = submissionRejected(rejected, {
    registered: false,
    registrationError: 'Transaction registration failed (400): ZodError',
  });

  const parsed = JSON.parse(response.content[0].text);
  assert.strictEqual(response.isError, true);
  assert.strictEqual(parsed.registered, false);
  assert.match(parsed.registrationError, /400/);
  assert.strictEqual(parsed.txHash, 'F48D5F3C');
});

test('submissionRejected omits registrationError when registration succeeded', () => {
  const response = submissionRejected(rejected, { registered: true });

  assert.strictEqual(
    'registrationError' in JSON.parse(response.content[0].text),
    false,
  );
});

test('registrationOutcome reports plain success when registration succeeds', () => {
  const response = registrationOutcome(
    'submitted',
    { txHash: 'ABC123', policyVersion: 5 },
    { registered: true },
    'setTargetAllocation',
  );

  assert.strictEqual(response.isError, undefined);
  assert.deepStrictEqual(JSON.parse(response.content[0].text), {
    status: 'submitted',
    txHash: 'ABC123',
    policyVersion: 5,
    registered: true,
  });
});

test('registrationOutcome reports failure when registration fails', () => {
  const response = registrationOutcome(
    'submitted',
    { txHash: 'ABC123', policyVersion: 5 },
    {
      registered: false,
      registrationError: 'Transaction registration failed (400): ZodError',
    },
    'setTargetAllocation',
  );

  assert.strictEqual(response.isError, true);

  const parsed = JSON.parse(response.content[0].text);
  assert.strictEqual(parsed.status, 'submitted_unregistered');
  assert.strictEqual(parsed.registered, false);
  assert.match(parsed.registrationError, /400/);
});

test('registrationOutcome preserves the payload and warns against retrying', () => {
  const response = registrationOutcome(
    'submitted',
    { txHash: 'ABC123', policyVersion: 5 },
    { registered: false, registrationError: 'boom' },
    'setTargetAllocation',
  );

  const parsed = JSON.parse(response.content[0].text);
  assert.strictEqual(parsed.txHash, 'ABC123');
  assert.strictEqual(parsed.policyVersion, 5);
  assert.match(parsed.warning, /setTargetAllocation SUCCEEDED on-chain/);
  assert.match(parsed.warning, /do NOT retry/);
});

test('registrationOutcome derives the unregistered status from the action', () => {
  const response = registrationOutcome(
    'redeemed',
    { redeemTx: 'DEF456', portfolioId: 95 },
    { registered: false, registrationError: 'boom' },
    'Invitation redemption',
  );

  const parsed = JSON.parse(response.content[0].text);
  assert.strictEqual(parsed.status, 'redeemed_unregistered');
  assert.strictEqual(parsed.redeemTx, 'DEF456');
  assert.strictEqual(parsed.portfolioId, 95);
  assert.match(parsed.warning, /Invitation redemption SUCCEEDED on-chain/);
});
