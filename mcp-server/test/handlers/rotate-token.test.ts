import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../src/state.ts';
import { handleRotateToken } from '../../src/handlers/rotate-token.ts';

test('handleRotateToken returns new token for valid session', async () => {
  const token = createSession('mnemonic', 'addr');
  const response = await handleRotateToken(token);

  assert.strictEqual(response.content.length, 1);
  assert.strictEqual(response.content[0].type, 'text');

  const parsed = JSON.parse(response.content[0].text);
  assert.ok(parsed.newBearerToken);
  assert.strictEqual(typeof parsed.newBearerToken, 'string');
  assert.notStrictEqual(parsed.newBearerToken, token);
});

test('handleRotateToken preserves session state under new token', async () => {
  const token = createSession('mnemonic', 'addr');
  const response = await handleRotateToken(token);
  const parsed = JSON.parse(response.content[0].text);

  // Original token should be dead
  const { getSession } = await import('../../src/state.ts');
  const originalSession = getSession(token);
  assert.strictEqual(originalSession, undefined);

  // New token should work
  const newSession = getSession(parsed.newBearerToken);
  assert.ok(newSession);
  assert.strictEqual(newSession.mnemonic, 'mnemonic');
  assert.strictEqual(newSession.address, 'addr');
});

test('handleRotateToken returns unauthorized for invalid token', async () => {
  const response = await handleRotateToken('nonexistent-token');

  assert.strictEqual(response.content.length, 1);
  assert.strictEqual(response.content[0].type, 'text');
  assert.strictEqual(response.content[0].text, 'unauthorized');
});
