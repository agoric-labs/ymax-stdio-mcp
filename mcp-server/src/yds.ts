import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResponse } from './types.ts';
import {
  DEFAULT_YMAX_INSTANCE,
  getYdsUrl,
  type YmaxInstance,
} from './ymax-instance.ts';

export interface YdsOptions {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  ymaxInstance?: YmaxInstance;
}

export type FlowDetail =
  | { type: 'deposit'; amount: string; fromChain: string }
  | { type: 'withdraw'; amount: string }
  | { type: 'rebalance' };

export interface ComputeTargetBalancesRequest {
  denom: string;
  currentAmounts: Record<string, string>;
  targetAllocation: Record<string, string>;
  action: FlowDetail;
}

export interface ComputeTargetBalancesResponse {
  message: 'Target balances computed successfully';
  denom: string;
  data: Record<string, string>;
  affectedPlaceCount: number;
  timestamp: string;
}

const naturalStringSchema = {
  type: 'string',
  pattern: '^(0|[1-9]\\d*)$',
  description: 'Non-negative bigint encoded as a base-10 string.',
};

const amountByAssetPlaceSchema = {
  type: 'object',
  additionalProperties: naturalStringSchema,
};

const flowDetailSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['deposit'] },
        amount: naturalStringSchema,
        fromChain: { type: 'string', minLength: 1 },
      },
      required: ['type', 'amount', 'fromChain'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['withdraw'] },
        amount: naturalStringSchema,
      },
      required: ['type', 'amount'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['rebalance'] },
      },
      required: ['type'],
      additionalProperties: false,
    },
  ],
};

export const SIMULATE_TARGET_ALLOCATION_TOOL: Tool = {
  name: 'simulate_target_allocation',
  description:
    'Read-only YDS planning simulation for a proposed YMax action. Computes changed target balances from the latest absolute amounts and proposed allocation without signing or broadcasting a transaction. A successful result does not guarantee that the route solver can execute the full cross-chain plan.',
  inputSchema: {
    type: 'object',
    properties: {
      denom: {
        type: 'string',
        minLength: 1,
        description:
          'JSON-safe denomination signifier. Amounts use its minor unit (for example, USDC amounts are in uusdc).',
      },
      currentAmounts: {
        ...amountByAssetPlaceSchema,
        description:
          'Latest absolute amounts by asset-place reference, encoded as minor-unit natural-number strings.',
      },
      targetAllocation: {
        ...amountByAssetPlaceSchema,
        description:
          'Proposed weights by instrument as natural-number strings. Their sum is the denominator, so percentage weights normally sum to 100.',
      },
      action: flowDetailSchema,
    },
    required: ['denom', 'currentAmounts', 'targetAllocation', 'action'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        enum: ['Target balances computed successfully'],
      },
      denom: { type: 'string', minLength: 1 },
      data: {
        ...amountByAssetPlaceSchema,
        description:
          'Changed target amounts by asset-place reference for the denomination.',
      },
      affectedPlaceCount: { type: 'integer', minimum: 0 },
      timestamp: { type: 'string', format: 'date-time' },
    },
    required: [
      'message',
      'denom',
      'data',
      'affectedPlaceCount',
      'timestamp',
    ],
    additionalProperties: false,
  },
  annotations: {
    title: 'Simulate target allocation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

/** Compute changed target amounts for a proposed YMax action. */
export async function computeTargetBalances(
  request: ComputeTargetBalancesRequest,
  options: YdsOptions,
): Promise<ComputeTargetBalancesResponse> {
  const ydsUrl = getYdsUrl(
    options.ymaxInstance ?? DEFAULT_YMAX_INSTANCE,
    options.env.YDS_URL,
  ).replace(/\/+$/, '');
  const response = await options.fetch(`${ydsUrl}/plan/computeTargetBalances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Computing target balances failed (${response.status}): ${body || response.statusText}`,
    );
  }

  return (await response.json()) as ComputeTargetBalancesResponse;
}

export async function handleSimulateTargetAllocation(
  request: ComputeTargetBalancesRequest,
  options: YdsOptions,
): Promise<ToolResponse> {
  const result = await computeTargetBalances(request, options);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: { ...result },
  };
}
