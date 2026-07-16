import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionState } from './types.ts';

export const DEFAULT_STATE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'state.json',
);

interface PersistedData {
  session?: SessionState;
}

interface PriorPersistedData extends PersistedData {
  sessions?: Record<string, SessionState>;
}

function load(file: string): PersistedData {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PriorPersistedData;
    if (parsed.session) return { session: parsed.session };

    // Preserve a sole delegate created by earlier single-user server versions.
    const priorSessions = Object.values(parsed.sessions ?? {});
    return priorSessions.length === 1 ? { session: priorSessions[0] } : {};
  } catch {
    return {};
  }
}

function save(file: string, data: PersistedData): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(tmp, file);
}

export interface SessionStore {
  setSession: (mnemonic: string, address: string) => void;
  getSession: () => SessionState | undefined;
  updateSession: (updates: Partial<SessionState>) => boolean;
}

export function makeSessionStore(file: string): SessionStore {
  const data = load(file);

  return {
    setSession(mnemonic: string, address: string): void {
      data.session = { mnemonic, address };
      save(file, data);
    },
    getSession(): SessionState | undefined {
      return data.session;
    },
    updateSession(updates: Partial<SessionState>): boolean {
      if (!data.session) return false;
      Object.assign(data.session, updates);
      save(file, data);
      return true;
    },
  };
}
