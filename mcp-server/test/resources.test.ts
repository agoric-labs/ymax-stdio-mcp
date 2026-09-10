import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_RESOURCES, RESOURCE_BY_URI } from '../src/resources.ts';

test('allocation guidance uses the typed MCP simulation without freezing solver details', () => {
  assert.deepStrictEqual(
    ALL_RESOURCES.map(resource => resource.uri),
    ['provisioning-runbook', 'ymax-onboarding', 'ymax-allocation-delegate'],
  );
  assert.strictEqual(RESOURCE_BY_URI['solver-constraints'], undefined);

  const guide = RESOURCE_BY_URI['ymax-allocation-delegate'].text;
  assert.match(guide, /simulate_target_allocation/);
  assert.doesNotMatch(guide, /\$2\.00|effective arc minimum|threshold rules/i);
});

test('agent guidance uses friendly instrument names in user-facing communication', () => {
  for (const uri of ['ymax-onboarding', 'ymax-allocation-delegate']) {
    const guide = RESOURCE_BY_URI[uri].text;
    assert.match(guide, /friendly instrument names/i);
    assert.match(guide, /canonical instrument keys/i);
  }
});

test('agent guidance implements deterministic parts of reusable strategies', () => {
  for (const uri of ['ymax-onboarding', 'ymax-allocation-delegate']) {
    const guide = RESOURCE_BY_URI[uri].text;
    assert.match(guide, /reusable strategy/i);
    assert.match(guide, /write code for its deterministic portions/i);
  }
});
