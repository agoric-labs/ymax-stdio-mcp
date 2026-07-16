import test from 'node:test';
import assert from 'node:assert/strict';
import { getPortfolioMandateDetails } from '../src/invitation.ts';

test('portfolio mandate details include portfolio binding', () => {
  assert.deepStrictEqual(
    getPortfolioMandateDetails({
      customDetails: {
        portfolioId: 84,
        agentId: 'agent2',
        permissions: { allocation: true },
      },
    }),
    {
      portfolioId: 84,
      agentId: 'agent2',
      permissions: { allocation: true },
    },
  );
});

test('portfolio mandate requires an integer portfolio id', () => {
  assert.throws(
    () =>
      getPortfolioMandateDetails({
        customDetails: { portfolioId: '84' },
      }),
    /valid portfolioId/,
  );
});
