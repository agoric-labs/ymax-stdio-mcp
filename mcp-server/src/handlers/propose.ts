import {
  buildCreateProposalUrl,
  buildEditProposalUrl,
  buildGrantProposalUrl,
} from '../proposals.ts';
import { hasPortfolioId, type SessionStore } from '../state.ts';
import { toolError } from '../responses.ts';
import type { ProposalParams, ToolResponse } from '../types.ts';

export async function handleProposeCreate(
  allocations: ProposalParams,
  state: Pick<SessionStore, 'getSession'>,
  ymaxUiUrl: string,
): Promise<ToolResponse> {
  const session = state.getSession();
  if (!session) {
    return toolError('no delegate state — call generate_delegate_key first');
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'create_and_delegate',
          url: buildCreateProposalUrl(
            ymaxUiUrl,
            allocations,
            session.address,
          ),
          permissions: { allocation: true },
        }),
      },
    ],
  };
}

export async function handleProposeGrant(
  state: Pick<SessionStore, 'getSession'>,
  ymaxUiUrl: string,
): Promise<ToolResponse> {
  const session = state.getSession();
  if (!session) {
    return toolError('no delegate state — call generate_delegate_key first');
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'delegate_existing_portfolio',
          url: buildGrantProposalUrl(ymaxUiUrl, session.address),
          permissions: { allocation: true },
        }),
      },
    ],
  };
}

export async function handleProposeEdit(
  allocations: ProposalParams,
  state: Pick<SessionStore, 'getSession'>,
  ymaxUiUrl: string,
): Promise<ToolResponse> {
  const session = state.getSession();
  if (!session || !hasPortfolioId(session)) {
    return toolError('no portfolio state — call redeem_invitation first');
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'owner_approval_required',
          url: buildEditProposalUrl(ymaxUiUrl, allocations),
          portfolioId: session.portfolioId,
        }),
      },
    ],
  };
}
