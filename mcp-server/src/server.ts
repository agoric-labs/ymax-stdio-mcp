import '@endo/init';

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load local configuration before constructing injected I/O below.
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
import {
  handleProposeCreate,
  handleProposeEdit,
  handleProposeGrant,
} from './handlers/propose.ts';
import { handleRedeem } from './handlers/redeem.ts';
import { handleSubmitAllocation } from './handlers/submit-allocation.ts';
import { DEFAULT_STATE_FILE, makeSessionStore } from './state.ts';
import type { ToolResponse } from './types.ts';

const RPC_URL = process.env.RPC_URL || 'https://main.rpc.agoric.net:443';
const YMAX_UI_URL =
  process.env.YMAX_UI_URL ||
  'https://staging-agentic-ui.ymax0-ui.pages.dev';
const sessionStore = makeSessionStore(
  process.env.YMAX_STATE_FILE || DEFAULT_STATE_FILE,
);
const agoricIO = {
  fetch: globalThis.fetch.bind(globalThis),
  agoricNet: process.env.AGORIC_NET || 'main',
};
const registrationIO = {
  fetch: agoricIO.fetch,
  ydsUrl: process.env.YDS_URL || 'https://main0.ymax.app',
  chainId: process.env.CHAIN_ID || 'agoric-3',
  ymaxInstance: process.env.YMAX_INSTANCE || 'ymax0',
};

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
    '2. propose_create — build a combined create-and-delegate UI link',
    '3. User creates, funds, and delegates in one YMax UI flow',
    '4. redeem_invitation — derive portfolio binding, redeem, and save state',
    '5. submit_target_allocation — allocate (repeat as needed)',
    '',
    'Order matters: provision BEFORE the combined UI flow. A grant before provisioning produces a revoked agent.',
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
      'Use generate_delegate_key to create and provision a delegate wallet, then propose_create to give the user one UI flow that creates the portfolio and grants allocation authority.',
      'After the user completes the UI flow, call redeem_invitation. The portfolio ID, agent ID, and permissions come from the delivered invitation.',
      'Then call submit_target_allocation to adjust instrument weights. You must preserve the existing instrument key set — query via YDS to discover it.',
      'Use propose_edit when the user should approve a proposed allocation or instrument-set change in the UI.',
      'Use propose_grant when delegating allocation authority over an existing portfolio.',
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
        'Create a new delegate key pair, fund the address from the MCP sponsor BLD wallet, and provision the smart wallet. The mnemonic is stored in the MCP server and never returned to the client.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'propose_create',
      description:
        'Build a YMax UI link that pre-populates portfolio allocations and the provisioned delegate address. The user creates, funds, and grants allocation authority in one UI flow. Allocation keys and values are forwarded without range or instrument validation so callers can exercise UI boundary behavior.',
      inputSchema: {
        type: 'object',
        properties: {
          allocations: {
            type: 'object',
            description:
              'Query parameters to pre-populate as instrument allocations. Values are forwarded unchanged.',
            additionalProperties: {
              anyOf: [{ type: 'number' }, { type: 'string' }],
            },
          },
        },
        required: ['allocations'],
      },
    },
    {
      name: 'redeem_invitation',
      description:
        'Poll for a delivered portfolioMandate invitation after the user completes the YMax UI flow. Derives the portfolio ID, agent ID, and permissions from the invitation, then redeems it and saves the delegation key as delegate-portfolio{NN}.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'propose_grant',
      description:
        'Build a YMax UI link that grants the provisioned delegate allocation authority over an existing portfolio. The user selects or confirms the portfolio in the UI; redeem_invitation derives the portfolio binding from the delivered invitation.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'propose_edit',
      description:
        'Build a YMax UI link that pre-populates an edit to the current portfolio. Instruments included by the user become part of the portfolio and therefore the effective allocation mandate. Keys and values are forwarded without range or instrument validation.',
      inputSchema: {
        type: 'object',
        properties: {
          allocations: {
            type: 'object',
            description:
              'Query parameters to pre-populate as instrument allocations. Values are forwarded unchanged.',
            additionalProperties: {
              anyOf: [{ type: 'number' }, { type: 'string' }],
            },
          },
        },
        required: ['allocations'],
      },
    },
    {
      name: 'submit_target_allocation',
      description:
        'Submit a setTargetAllocation transaction signed by the stored delegation key. Automatically registers the tx hash via POST /transactions to bridge activity page visibility. Uses the portfolio ID and delegation key name saved during redeem_invitation.',
      inputSchema: {
        type: 'object',
        properties: {
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
        required: ['allocations'],
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
          const result = await handleGenerateKey(sessionStore, {
            sponsor: {
              rpcUrl: RPC_URL,
              amount: process.env.SPONSOR_AMOUNT || '20000000',
              mnemonic: process.env.SPONSOR_MNEMONIC,
              privateKey: process.env.SPONSOR_PRIVATE_KEY,
            },
            provision: { rpcUrl: RPC_URL },
          });
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'redeem_invitation': {
          const res = await handleRedeem({ ...agoricIO, state: sessionStore });
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return res;
        }

        case 'propose_create': {
          const { allocations } = args as {
            allocations: Record<string, number | string>;
          };
          const res = await handleProposeCreate(
            allocations,
            sessionStore,
            YMAX_UI_URL,
          );
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return res;
        }

        case 'propose_edit': {
          const { allocations } = args as {
            allocations: Record<string, number | string>;
          };
          const res = await handleProposeEdit(
            allocations,
            sessionStore,
            YMAX_UI_URL,
          );
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return res;
        }

        case 'propose_grant': {
          const res = await handleProposeGrant(sessionStore, YMAX_UI_URL);
          log(`tool ok: ${name} (${Date.now() - started}ms)`);
          return res;
        }

        case 'submit_target_allocation': {
          const { allocations } = args as {
            allocations: Record<string, number>;
          };
          const res = await handleSubmitAllocation(allocations, {
            ...agoricIO,
            state: sessionStore,
            registration: registrationIO,
          });
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
