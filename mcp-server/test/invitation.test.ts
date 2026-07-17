import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findPortfolioMandateInvitation,
  getPortfolioMandateDetails,
} from '../src/invitation.ts';

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

test('portfolio mandate rejects malformed portfolio ids', () => {
  assert.throws(
    () =>
      getPortfolioMandateDetails({
        customDetails: { portfolioId: 'portfolio-84' },
      }),
    /valid portfolioId/,
  );
});

test('portfolio mandate accepts portfolio-prefixed ids', () => {
  assert.deepStrictEqual(
    getPortfolioMandateDetails({
      customDetails: {
        portfolioId: 'portfolio83',
        agentId: 'agent3',
        permissions: { allocation: true },
      },
    }),
    {
      portfolioId: 83,
      agentId: 'agent3',
      permissions: { allocation: true },
    },
  );
});

test('finds a portfolio mandate invitation in current wallet purses', () => {
  const invitation = findPortfolioMandateInvitation({
    purses: [
      {
        balance: {
          value: [],
        },
      },
      {
        balance: {
          value: [
            {
              description: 'portfolioMandate',
              customDetails: {
                portfolioId: 83,
                agentId: 'agent3',
                permissions: { allocation: true },
              },
            },
          ],
        },
      },
    ],
  });

  assert.deepStrictEqual(invitation, {
    description: 'portfolioMandate',
    customDetails: {
      portfolioId: 83,
      agentId: 'agent3',
      permissions: { allocation: true },
    },
  });
});
