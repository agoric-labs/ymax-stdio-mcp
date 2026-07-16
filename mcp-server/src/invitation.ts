export interface PortfolioMandateDetails {
  portfolioId: number;
  agentId?: string;
  permissions?: Record<string, boolean>;
}

export function getPortfolioMandateDetails(invitation: {
  customDetails?: unknown;
}): PortfolioMandateDetails {
  const details = invitation.customDetails;
  if (!details || typeof details !== 'object') {
    throw new Error('portfolioMandate invitation has no details');
  }

  const { portfolioId, agentId, permissions } = details as Record<
    string,
    unknown
  >;
  if (
    typeof portfolioId !== 'number' ||
    !Number.isSafeInteger(portfolioId) ||
    portfolioId < 0
  ) {
    throw new Error('portfolioMandate invitation has no valid portfolioId');
  }

  return {
    portfolioId,
    ...(typeof agentId === 'string' ? { agentId } : {}),
    ...(permissions && typeof permissions === 'object'
      ? { permissions: permissions as Record<string, boolean> }
      : {}),
  };
}
