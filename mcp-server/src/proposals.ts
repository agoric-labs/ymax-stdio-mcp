import type { ProposalParams } from './types.ts';

const appendAllocations = (
  url: URL,
  allocations: ProposalParams,
): void => {
  for (const [instrument, value] of Object.entries(allocations)) {
    url.searchParams.append(instrument, String(value));
  }
};

export function buildCreateProposalUrl(
  uiUrl: string,
  allocations: ProposalParams,
  accountHolder: string,
): string {
  const url = new URL('/create-portfolio', uiUrl);
  appendAllocations(url, allocations);
  url.searchParams.set('accountHolder', accountHolder);
  url.searchParams.set('permissions', 'change-allocations');
  return url.toString();
}

export function buildEditProposalUrl(
  uiUrl: string,
  allocations: ProposalParams,
): string {
  const url = new URL('/edit-portfolio', uiUrl);
  appendAllocations(url, allocations);
  return url.toString();
}
