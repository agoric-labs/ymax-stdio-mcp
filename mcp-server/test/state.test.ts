import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  getSession,
  rotateToken,
  updateSession,
} from '../src/state.ts';

test('createSession returns a token string', () => {
  const token = createSession('test mnemonic', 'agoric1abc');
  assert.strictEqual(typeof token, 'string');
  assert.ok(token.length > 0);
});

test('getSession returns session for valid token', () => {
  const token = createSession('test mnemonic', 'agoric1abc');
  const session = getSession(token);
  assert.ok(session);
  assert.strictEqual(session.mnemonic, 'test mnemonic');
  assert.strictEqual(session.address, 'agoric1abc');
  assert.strictEqual(session.portfolioId, undefined);
  assert.strictEqual(session.delegationKeyName, undefined);
});

test('getSession returns undefined for invalid token', () => {
  const session = getSession('nonexistent-token');
  assert.strictEqual(session, undefined);
});

test('rotateToken returns a new token', () => {
  const oldToken = createSession('test mnemonic', 'agoric1abc');
  const newToken = rotateToken(oldToken);
  assert.ok(newToken);
  assert.strictEqual(typeof newToken, 'string');
  assert.notStrictEqual(newToken, oldToken);
});

test('rotateToken invalidates old token', () => {
  const oldToken = createSession('test mnemonic', 'agoric1abc');
  const newToken = rotateToken(oldToken);
  assert.ok(newToken);

  const oldSession = getSession(oldToken);
  assert.strictEqual(oldSession, undefined);

  const newSession = getSession(newToken);
  assert.ok(newSession);
  assert.strictEqual(newSession.mnemonic, 'test mnemonic');
});

test('rotateToken preserves session state', () => {
  const token = createSession('mnemonic-1', 'addr-1');
  updateSession(token, { portfolioId: 84, delegationKeyName: 'delegate-portfolio84' });

  const newToken = rotateToken(token);
  assert.ok(newToken);

  const session = getSession(newToken);
  assert.ok(session);
  assert.strictEqual(session.mnemonic, 'mnemonic-1');
  assert.strictEqual(session.address, 'addr-1');
  assert.strictEqual(session.portfolioId, 84);
  assert.strictEqual(session.delegationKeyName, 'delegate-portfolio84');
});

test('rotateToken returns undefined for invalid token', () => {
  const result = rotateToken('nonexistent-token');
  assert.strictEqual(result, undefined);
});

test('updateSession updates session fields', () => {
  const token = createSession('mnemonic', 'addr');
  const updated = updateSession(token, { portfolioId: 84 });
  assert.strictEqual(updated, true);

  const session = getSession(token);
  assert.ok(session);
  assert.strictEqual(session.portfolioId, 84);
});

test('updateSession returns false for invalid token', () => {
  const result = updateSession('nonexistent-token', { portfolioId: 84 });
  assert.strictEqual(result, false);
});
