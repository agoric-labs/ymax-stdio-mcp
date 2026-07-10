import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionState } from './types.ts';

const FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'state.json',
);

interface PersistedData {
  sessions: Record<string, SessionState>;
  tokenToSession: Record<string, string>;
}

function load(): PersistedData {
  if (!existsSync(FILE)) return { sessions: {}, tokenToSession: {} };
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return { sessions: {}, tokenToSession: {} };
  }
}

function save(data: PersistedData): void {
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, FILE);
}

const data: PersistedData = load();

const sessions = new Map(Object.entries(data.sessions));
const tokenToSession = new Map(Object.entries(data.tokenToSession));

function persist(): void {
  data.sessions = Object.fromEntries(sessions);
  data.tokenToSession = Object.fromEntries(tokenToSession);
  save(data);
}

export function createSession(mnemonic: string, address: string): string {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { mnemonic, address });
  const token = crypto.randomUUID();
  tokenToSession.set(token, sessionId);
  persist();
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
  persist();
  return newToken;
}

export function updateSession(
  token: string,
  updates: Partial<SessionState>,
): boolean {
  const session = getSession(token);
  if (!session) return false;
  Object.assign(session, updates);
  persist();
  return true;
}
