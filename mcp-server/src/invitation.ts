export interface PortfolioMandateDetails {
  portfolioId: number;
  agentId?: string;
  permissions?: Record<string, boolean>;
}

export interface PortfolioMandateInvitation {
  description: string;
  instance?: unknown;
  customDetails?: unknown;
  acceptedIn?: string | number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const parsePortfolioId = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.match(/^(?:portfolio)?(\d+)$/);
  if (!match) {
    return undefined;
  }

  const portfolioId = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(portfolioId) ? portfolioId : undefined;
};

export function findPortfolioMandateInvitation(currentWalletRecord: {
  purses?: Array<{ balance?: { value?: unknown } }>;
}): PortfolioMandateInvitation | undefined {
  for (const purse of currentWalletRecord.purses || []) {
    const invitations = purse?.balance?.value;
    if (!Array.isArray(invitations)) {
      continue;
    }

    for (const invitation of invitations) {
      const candidate = asRecord(invitation);
      if (!candidate || candidate.description !== 'portfolioMandate') {
        continue;
      }
      return candidate as PortfolioMandateInvitation;
    }
  }

  return undefined;
}

export function getPortfolioMandateDetails(invitation: {
  customDetails?: unknown;
}): PortfolioMandateDetails {
  const details = asRecord(invitation.customDetails);
  if (!details) {
    throw new Error('portfolioMandate invitation has no details');
  }

  const { portfolioId, agentId, permissions } = details;
  const parsedPortfolioId = parsePortfolioId(portfolioId);
  if (parsedPortfolioId === undefined) {
    throw new Error('portfolioMandate invitation has no valid portfolioId');
  }

  return {
    portfolioId: parsedPortfolioId,
    ...(typeof agentId === 'string' ? { agentId } : {}),
    ...(permissions && typeof permissions === 'object'
      ? { permissions: permissions as Record<string, boolean> }
      : {}),
  };
}
