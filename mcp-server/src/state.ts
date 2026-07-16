import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionState } from './types.ts';

const FILE =
  process.env.YMAX_STATE_FILE ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'state.json');

interface PersistedData {
  session?: SessionState;
}

interface PriorPersistedData extends PersistedData {
  sessions?: Record<string, SessionState>;
}

function load(): PersistedData {
  if (!existsSync(FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as PriorPersistedData;
    if (parsed.session) return { session: parsed.session };

    // Preserve a sole delegate created by earlier single-user server versions.
    const priorSessions = Object.values(parsed.sessions ?? {});
    return priorSessions.length === 1 ? { session: priorSessions[0] } : {};
  } catch {
    return {};
  }
}

function save(data: PersistedData): void {
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(tmp, FILE);
}

const data = load();

export function setSession(mnemonic: string, address: string): void {
  data.session = { mnemonic, address };
  save(data);
}

export function getSession(): SessionState | undefined {
  return data.session;
}

export function updateSession(updates: Partial<SessionState>): boolean {
  if (!data.session) return false;
  Object.assign(data.session, updates);
  save(data);
  return true;
}
