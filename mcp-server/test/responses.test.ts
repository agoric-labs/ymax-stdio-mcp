import test from 'node:test';
import assert from 'node:assert/strict';
import { toolError } from '../src/responses.ts';

test('tool errors are marked as MCP errors', () => {
  assert.deepStrictEqual(toolError('no portfolio state'), {
    content: [{ type: 'text', text: 'no portfolio state' }],
    isError: true,
  });
});
