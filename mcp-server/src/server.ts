import '@endo/init';

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env file before any other imports that read process.env
const envPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.env',
);
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    let key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (key.startsWith('export ')) key = key.slice(7);
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { handleGenerateKey } from './handlers/generate-key.ts';
import { handleRedeem } from './handlers/redeem.ts';
import { handleSubmitAllocation } from './handlers/submit-allocation.ts';
import { handleRotateToken } from './handlers/rotate-token.ts';
import type { ToolResponse } from './types.ts';

const SOLVER_CONSTRAINTS = {
  uri: 'solver-constraints',
  name: 'Solver Minimum Transfer Thresholds',
  description:
    'Multi-layer minimum transfer amounts enforced by the YMax rebalance solver. Clients use this to size allocations before calling submit_target_allocation.',
  mimeType: 'application/json',
  text: JSON.stringify(
    {
      thresholds: [
        {
          name: 'CCTP hard runtime floor',
          amount: '$1.00 (1,000,000 uusdc)',
          layer: 'Hard Fail — bridge leg must be ≥ $1.00',
          source: 'pos-evm.flows.ts:191-216',
        },
        {
          name: 'Delta soft minimum',
          amount: '$1.00 (1,000,000 uusdc)',
          layer:
            'Position deltas < $1.00 suppressed before solver sees them',
          source: 'target-balances.ts:20',
        },
        {
          name: 'CCTPv2 EVM→EVM link min',
          amount: '$0.10 (100,000 uusdc)',
          layer: 'LP coupling constraint',
          source: 'prod-network.ts',
        },
        {
          name: 'CCTP-from-Noble link min',
          amount: '$1.00 (1,000,000 uusdc)',
          layer: 'LP coupling constraint',
          source: 'prod-network.ts',
        },
        {
          name: 'Account dust epsilon',
          amount: '$0.0001 (100 uusdc)',
          layer: 'Balance filtering (not a practical constraint)',
          source: 'constants.js:189-193',
        },
        {
          name: 'Effective arc minimum (in practice)',
          amount: '$1.47–$2.00',
          layer:
            'Combines link min + CCTP fee + delta soft min + arc interactions',
          source: 'LP solver coupling constraints',
        },
      ],
      practicalRules: [
        'Same-chain deltas: ≥ $1.00 (≈ 2.2% weight at $45 TVL)',
        'Cross-chain deltas: ≥ $2.00 (≈ 4.5% weight at $45 TVL)',
        'At sub-$100 TVL, use deltas of +5 to +15 percentage points to avoid solver rejection',
        'Residuals below $1.00 on non-native chain are likely stranded',
      ],
    },
    null,
    2,
  ),
};

const PROVISIONING_RUNBOOK = {
  uri: 'provisioning-runbook',
  name: 'Provisioning Runbook',
  description:
    'Correct ordering for onboarding a YMax allocation delegate. Derived from live mainnet experience.',
  mimeType: 'text/plain',
  text: [
    '1. generate_delegate_key — keygen + sponsor fund + smart-wallet provision (single atomic MCP tool)',
    '2. User completes YMax grant via UI using the returned address',
    '3. redeem_invitation — poll + redeem + save portfolio state',
    '4. submit_target_allocation — allocate (repeat as needed)',
    '',
    'Order matters: provision BEFORE grant. A grant before provisioning produces a revoked agent.',
    '',
    'For complete onboarding instructions, read the ymax-onboarding resource.',
  ].join('\n'),
};

const RESOURCES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'resources',
);

function readResource(filename: string): string {
  const path = resolve(RESOURCES_DIR, filename);
  if (!existsSync(path)) {
    throw new Error(`resource file not found: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

const ONBOARDING_SKILL = {
  uri: 'ymax-onboarding',
  name: 'YMax Agent Onboarding',
  description:
    'Complete onboarding guide: role boundaries, URL conventions, run order, failure triage, and reporting template. Read this when starting a new onboarding flow.',
  mimeType: 'text/markdown',
  text: readResource('onboarding.md'),
};

const ALLOCATION_SKILL = {
  uri: 'ymax-allocation-delegate',
  name: 'YMax Allocation Delegate',
  description:
    'Complete allocation delegate guide: scope, guardrails, candidate building heuristics, minimum transfer thresholds, verification protocol, and retry/escalation rules. Read this before submitting allocation changes.',
  mimeType: 'text/markdown',
  text: readResource('allocation.md'),
};

const server = new Server(
  {
    name: 'ymax-yield-agent',
    version: '0.1.0',
    description:
      'YMax yield agent for Agoric mainnet. Manages delegated cross-chain yield portfolio allocations on ymax0.',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
    instructions: [
      'Use generate_delegate_key to create a new delegate wallet (returns address for grant UI + bearer token). Never display the bearer token to the user — it is a machine credential.',
      'After the user grants via the YMax UI, call redeem_invitation with the portfolio ID.',
      'Then call submit_target_allocation to adjust instrument weights. You must preserve the existing instrument key set — query via YDS to discover it.',
      'The solver enforces minimum transfer thresholds — consult solver-constraints resource for limits.',
      'Provision must happen BEFORE grant. See provisioning-runbook and ymax-onboarding resources for the full run order.',
      'Before submitting an allocation, read ymax-allocation-delegate for guardrails, candidate-building heuristics, and escalation rules.',
    ].join('\n'),
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_delegate_key',
      description:
        'Create a new delegate key pair, fund the address from the MCP sponsor BLD wallet, and provision the smart wallet. Returns the delegate address (for the grant UI) and a bearer token (for subsequent calls only — never display the token to the user). The mnemonic is stored in the MCP server and never returned to the client.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'redeem_invitation',
      description:
        'Poll for a delivered portfolioMandate invitation (after the user completes the grant via YMax UI) and redeem it. Saves the delegation key in the wallet store as delegate-portfolio{NN} and stores the portfolio ID in server state. Subsequent calls using the same bearer token can reference the portfolio and delegation key automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          bearerToken: {
            type: 'string',
            description: 'Bearer token from generate_delegate_key',
          },
          portfolioId: {
            type: 'number',
            description: 'Portfolio number (e.g. 84)',
          },
        },
        required: ['bearerToken', 'portfolioId'],
      },
    },
    {
      name: 'submit_target_allocation',
      description:
        'Submit a setTargetAllocation transaction signed by the stored delegation key. Automatically registers the tx hash via POST /transactions to bridge activity page visibility. Uses the portfolio ID and delegation key name saved during redeem_invitation.',
      inputSchema: {
        type: 'object',
        properties: {
          bearerToken: {
            type: 'string',
            description: 'Bearer token from generate_delegate_key',
          },
          allocations: {
            type: 'object',
            description:
              'Instrument weights as percentage integers. Must match the portfolio current key set.',
            patternProperties: {
              '^[A-Za-z0-9_]+$': { type: 'number' },
            },
            additionalProperties: { type: 'number' },
          },
        },
        required: ['bearerToken', 'allocations'],
      },
    },
    {
      name: 'rotate_token',
      description:
        'Invalidate the current bearer token and issue a new one. All server state (mnemonic, portfolio bindings, delegation key references) is preserved under the new token. No on-chain changes.',
      inputSchema: {
        type: 'object',
        properties: {
          bearerToken: {
            type: 'string',
            description: 'Current bearer token to rotate',
          },
        },
        required: ['bearerToken'],
      },
    },
  ],
}));

const ALL_RESOURCES = [
  SOLVER_CONSTRAINTS,
  PROVISIONING_RUNBOOK,
  ONBOARDING_SKILL,
  ALLOCATION_SKILL,
];

const RESOURCE_BY_URI: Record<string, typeof SOLVER_CONSTRAINTS> = {};
for (const r of ALL_RESOURCES) {
  RESOURCE_BY_URI[r.uri] = r;
}

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: ALL_RESOURCES.map(r => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  })),
}));

server.setRequestHandler(ReadResourceRequestSchema, async request => {
  const { uri } = request.params;
  const resource = RESOURCE_BY_URI[uri];

  if (!resource) {
    throw new Error(`unknown resource: ${uri}`);
  }

  return {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resource.text,
      },
    ],
  };
});

const log = (...args: unknown[]) =>
  console.error('-- ymax-mcp:', ...args);

server.setRequestHandler(
  CallToolRequestSchema,
  async (request): Promise<ToolResponse> => {
    const { name, arguments: args } = request.params;
    const started = Date.now();
    log(`tool call: ${name}`);

    try {
      switch (name) {
        case 'generate_delegate_key': {
          const result = await handleGenerateKey();
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'redeem_invitation': {
          const { bearerToken, portfolioId } = args as {
            bearerToken: string;
            portfolioId: number;
          };
          const res = await handleRedeem(bearerToken, portfolioId);
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return res;
        }

        case 'submit_target_allocation': {
          const { bearerToken, allocations } = args as {
            bearerToken: string;
            allocations: Record<string, number>;
          };
          const res = await handleSubmitAllocation(bearerToken, allocations);
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return res;
        }

        case 'rotate_token': {
          const { bearerToken } = args as { bearerToken: string };
          const res = await handleRotateToken(bearerToken);
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return res;
        }

        default:
          log(`tool unknown: ${name}`);
          return {
            content: [
              { type: 'text', text: `unknown tool: ${name}` },
            ],
          };
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'internal server error';
      log(`tool err: ${name} (${Date.now() - started}ms) — ${message}`);
      return {
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
