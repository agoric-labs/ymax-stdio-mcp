import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_RESOURCES, RESOURCE_BY_URI } from '../src/resources.ts';

test('allocation guidance discovers YDS simulation instead of freezing solver details', () => {
  assert.deepStrictEqual(
    ALL_RESOURCES.map(resource => resource.uri),
    ['provisioning-runbook', 'ymax-onboarding', 'ymax-allocation-delegate'],
  );
  assert.strictEqual(RESOURCE_BY_URI['solver-constraints'], undefined);

  const guide = RESOURCE_BY_URI['ymax-allocation-delegate'].text;
  assert.match(guide, /GET \/openapi\.json/);
  assert.doesNotMatch(
    guide,
    /computeTargetBalances|\$2\.00|effective arc minimum|threshold rules/i,
  );
});
