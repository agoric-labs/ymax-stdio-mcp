import { buildCreateProposalUrl, buildEditProposalUrl } from '../proposals.ts';
import { getSession } from '../state.ts';
import type { ProposalParams, ToolResponse } from '../types.ts';

const getYmaxUiUrl = (): string =>
  process.env.YMAX_UI_URL ||
  'https://staging-agentic-ui.ymax0-ui.pages.dev';

export async function handleProposeCreate(
  allocations: ProposalParams,
): Promise<ToolResponse> {
  const session = getSession();
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: 'no delegate state — call generate_delegate_key first',
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'create_and_delegate',
          url: buildCreateProposalUrl(
            getYmaxUiUrl(),
            allocations,
            session.address,
          ),
          permissions: { allocation: true },
        }),
      },
    ],
  };
}

export async function handleProposeEdit(
  allocations: ProposalParams,
): Promise<ToolResponse> {
  const session = getSession();
  if (!session?.portfolioId) {
    return {
      content: [
        {
          type: 'text',
          text: 'no portfolio state — call redeem_invitation first',
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'owner_approval_required',
          url: buildEditProposalUrl(getYmaxUiUrl(), allocations),
          portfolioId: session.portfolioId,
        }),
      },
    ],
  };
}
