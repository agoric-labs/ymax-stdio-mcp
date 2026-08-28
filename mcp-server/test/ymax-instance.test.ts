import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDelegateYmaxInstance,
  getYdsUrl,
  getYmaxUiUrl,
  parseYmaxInstance,
} from '../src/ymax-instance.ts';

test('new onboarding defaults to ymax1', () => {
  assert.strictEqual(parseYmaxInstance(undefined), 'ymax1');
});

test('onboarding accepts either known instance', () => {
  assert.strictEqual(parseYmaxInstance('ymax0'), 'ymax0');
  assert.strictEqual(parseYmaxInstance('ymax1'), 'ymax1');
  assert.throws(() => parseYmaxInstance('ymax2'), /ymax0 or ymax1/);
});

test('legacy delegates remain bound to ymax0', () => {
  assert.strictEqual(getDelegateYmaxInstance({}), 'ymax0');
  assert.strictEqual(
    getDelegateYmaxInstance({ ymaxInstance: 'ymax1' }),
    'ymax1',
  );
});

test('the UI stays on the staging agentic deployment', () => {
  assert.strictEqual(
    getYmaxUiUrl(undefined),
    'https://staging-agentic-ui.ymax0-ui.pages.dev',
  );
});

test('YDS defaults follow the selected instance', () => {
  assert.strictEqual(getYdsUrl('ymax1', undefined), 'https://main1.ymax.app');
  assert.strictEqual(getYdsUrl('ymax0', undefined), 'https://main0.ymax.app');
});

test('explicit endpoint overrides apply without passing the environment', () => {
  assert.strictEqual(
    getYmaxUiUrl('https://example.test/ui'),
    'https://example.test/ui',
  );
  assert.strictEqual(
    getYdsUrl('ymax0', 'https://example.test/yds'),
    'https://example.test/yds',
  );
});
