import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TextResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
}

const PROVISIONING_RUNBOOK: TextResource = {
  uri: 'provisioning-runbook',
  name: 'Provisioning Runbook',
  description:
    'Correct ordering for onboarding a YMax allocation delegate. Derived from live mainnet experience.',
  mimeType: 'text/plain',
  text: [
    '1. generate_delegate_key - keygen + sponsor fund + smart-wallet provision (single atomic MCP tool)',
    '2. propose_create - build a combined create-and-delegate UI link',
    '3. User creates, funds, and delegates in one YMax UI flow',
    '4. redeem_invitation - derive portfolio binding, redeem, and save state',
    '5. submit_target_allocation - allocate (repeat as needed)',
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

const readResource = (filename: string): string => {
  const path = resolve(RESOURCES_DIR, filename);
  if (!existsSync(path)) {
    throw new Error(`resource file not found: ${path}`);
  }
  return readFileSync(path, 'utf8');
};

const ONBOARDING_SKILL: TextResource = {
  uri: 'ymax-onboarding',
  name: 'YMax Agent Onboarding',
  description:
    'Complete onboarding guide: role boundaries, URL conventions, run order, failure triage, and reporting template. Read this when starting a new onboarding flow.',
  mimeType: 'text/markdown',
  text: readResource('onboarding.md'),
};

const ALLOCATION_SKILL: TextResource = {
  uri: 'ymax-allocation-delegate',
  name: 'YMax Allocation Delegate',
  description:
    'Complete allocation delegate guide: scope, guardrails, YDS candidate evaluation, verification protocol, and retry/escalation rules. Read this before submitting allocation changes.',
  mimeType: 'text/markdown',
  text: readResource('allocation.md'),
};

export const ALL_RESOURCES = [
  PROVISIONING_RUNBOOK,
  ONBOARDING_SKILL,
  ALLOCATION_SKILL,
];

export const RESOURCE_BY_URI = Object.fromEntries(
  ALL_RESOURCES.map(resource => [resource.uri, resource]),
) as Record<string, TextResource>;
