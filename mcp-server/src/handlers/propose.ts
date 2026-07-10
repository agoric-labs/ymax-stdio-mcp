import {
  buildCreateProposalUrl,
  buildEditProposalUrl,
  buildGrantProposalUrl,
} from '../proposals.ts';
import {
  hasPortfolioId,
  type StateStore,
} from '../state.ts';
import { toolError } from '../responses.ts';
import type { ProposalParams, ToolResponse } from '../types.ts';

export async function handleProposeCreate(
  allocations: ProposalParams,
  state: Pick<StateStore, 'getActiveDelegate'>,
  ymaxUiUrl: string,
): Promise<ToolResponse> {
  const activeDelegate = state.getActiveDelegate();
  if (!activeDelegate) {
    return toolError('no active delegate — call generate_delegate_key first');
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
            activeDelegate.address,
          ),
          permissions: { allocation: true },
        }),
      },
    ],
  };
}

export async function handleProposeGrant(
  state: Pick<StateStore, 'getActiveDelegate'>,
  ymaxUiUrl: string,
): Promise<ToolResponse> {
  const activeDelegate = state.getActiveDelegate();
  if (!activeDelegate) {
    return toolError('no active delegate — call generate_delegate_key first');
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'delegate_existing_portfolio',
          url: buildGrantProposalUrl(ymaxUiUrl, activeDelegate.address),
          permissions: { allocation: true },
        }),
      },
    ],
  };
}

export async function handleProposeEdit(
  allocations: ProposalParams,
  state: Pick<StateStore, 'getActiveDelegate'>,
  ymaxUiUrl: string,
): Promise<ToolResponse> {
  const activeDelegate = state.getActiveDelegate();
  if (!activeDelegate || !hasPortfolioId(activeDelegate)) {
    return toolError('no portfolio state — call redeem_invitation first');
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'owner_approval_required',
          url: buildEditProposalUrl(ymaxUiUrl, allocations),
          portfolioId: activeDelegate.portfolioId,
        }),
      },
    ],
  };
}
