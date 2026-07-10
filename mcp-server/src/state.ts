import type { SessionState } from './types.ts';

const sessions = new Map<string, SessionState>();
const tokenToSession = new Map<string, string>();

export function createSession(mnemonic: string, address: string): string {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { mnemonic, address });
  const token = crypto.randomUUID();
  tokenToSession.set(token, sessionId);
  return token;
}

export function getSession(token: string): SessionState | undefined {
  const sessionId = tokenToSession.get(token);
  if (!sessionId) return undefined;
  return sessions.get(sessionId);
}

export function rotateToken(oldToken: string): string | undefined {
  const sessionId = tokenToSession.get(oldToken);
  if (!sessionId) return undefined;
  tokenToSession.delete(oldToken);
  const newToken = crypto.randomUUID();
  tokenToSession.set(newToken, sessionId);
  return newToken;
}

export function updateSession(
  token: string,
  updates: Partial<SessionState>,
): boolean {
  const session = getSession(token);
  if (!session) return false;
  Object.assign(session, updates);
  return true;
}
