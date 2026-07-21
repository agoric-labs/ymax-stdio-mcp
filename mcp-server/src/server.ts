import '@endo/init';

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import {
  DEFAULT_STATE_FILE,
  makeStateStore,
  type StateStore,
} from './state.ts';
import { toolError } from './responses.ts';
import { ALL_RESOURCES, RESOURCE_BY_URI } from './resources.ts';
import type { ToolResponse } from './types.ts';

interface ServerPowers {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  setTimeout: typeof setTimeout;
  now: () => Date;
  stateStore: StateStore;
}

function loadDotEnv(env: NodeJS.ProcessEnv): void {
  const envPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '.env',
  );
  if (!existsSync(envPath)) return;

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
    if (!env[key]) {
      env[key] = value;
    }
  }
}

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
      'Then call submit_target_allocation to adjust instrument weights. You must preserve the existing instrument key set - query via YDS to discover it.',
      'Use propose_edit when the user should approve a proposed allocation or instrument-set change in the UI.',
      'Use propose_grant when delegating allocation authority over an existing portfolio.',
      'Provision must happen BEFORE grant. See provisioning-runbook and ymax-onboarding resources for the full run order.',
      'Before submitting an allocation, read ymax-allocation-delegate and use the current YDS OpenAPI specification to discover and run its planning simulation.',
    ].join('\n'),
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_delegate_key',
      description:
        'Create a new delegate key pair, fund the address from the MCP sponsor BLD wallet, and provision the smart wallet. Returns the delegate address for the grant UI. The mnemonic is stored in the MCP server and never returned to the client. Refuses to replace an existing active delegate unless clobberActiveDelegate is true.',
      inputSchema: {
        type: 'object',
        properties: {
          clobberActiveDelegate: {
            type: 'boolean',
            description:
              'Set true only when you intentionally want to replace the existing active delegate.',
          },
        },
        required: ['clobberActiveDelegate'],
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

function installToolHandlers(powers: ServerPowers): void {
  const ymaxUiUrl =
    powers.env.YMAX_UI_URL ||
    'https://staging-agentic-ui.ymax0-ui.pages.dev';

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<ToolResponse> => {
      const { name, arguments: args } = request.params;
      const started = Date.now();
      log(`tool call: ${name}`);

      try {
        switch (name) {
          case 'generate_delegate_key': {
            const { clobberActiveDelegate } = args as {
              clobberActiveDelegate: boolean;
            };
            const result = await handleGenerateKey(
              clobberActiveDelegate,
              powers,
            );
            log(`tool ok: ${name} (${Date.now() - started}ms)`);
            return {
              content: [
                { type: 'text', text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          case 'redeem_invitation': {
            const res = await handleRedeem(powers);
            log(`tool ok: ${name} (${Date.now() - started}ms)`);
            return res;
          }

          case 'propose_create': {
            const { allocations } = args as {
              allocations: Record<string, number | string>;
            };
            const res = await handleProposeCreate(
              allocations,
              powers.stateStore,
              ymaxUiUrl,
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
              powers.stateStore,
              ymaxUiUrl,
            );
            log(`tool ok: ${name} (${Date.now() - started}ms)`);
            return res;
          }

          case 'propose_grant': {
            const res = await handleProposeGrant(
              powers.stateStore,
              ymaxUiUrl,
            );
            log(`tool ok: ${name} (${Date.now() - started}ms)`);
            return res;
          }

          case 'submit_target_allocation': {
            const { allocations } = args as {
              allocations: Record<string, number>;
            };
            const res = await handleSubmitAllocation(allocations, powers);
            log(`tool ok: ${name} (${Date.now() - started}ms)`);
            return res;
          }

          default:
            log(`tool unknown: ${name}`);
            return toolError(`unknown tool: ${name}`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'internal server error';
        log(`tool err: ${name} (${Date.now() - started}ms) - ${message}`);
        return toolError(message);
      }
    },
  );
}

loadDotEnv(process.env);
installToolHandlers({
  env: process.env,
  fetch: globalThis.fetch.bind(globalThis),
  setTimeout: globalThis.setTimeout,
  now: () => new Date(),
  stateStore: makeStateStore(
    process.env.YMAX_STATE_FILE || DEFAULT_STATE_FILE,
  ),
});

const transport = new StdioServerTransport();
await server.connect(transport);
