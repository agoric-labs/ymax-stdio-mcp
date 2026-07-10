import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DelegateState } from './types.ts';

export const DEFAULT_STATE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'state.json',
);

interface PersistedData {
  delegates: Record<string, DelegateState>;
  activeDelegateId?: string;
}

interface PriorPersistedData extends Partial<PersistedData> {
  session?: DelegateState;
  sessions?: Record<string, DelegateState>;
}

export interface StateStore {
  createActiveDelegate(mnemonic: string, address: string): string;
  getActiveDelegate(): DelegateState | undefined;
  updateActiveDelegate(updates: Partial<DelegateState>): boolean;
}

export const hasPortfolioId = (
  delegate: DelegateState,
): delegate is DelegateState & { portfolioId: number } =>
  delegate.portfolioId !== undefined;

function load(file: string): PersistedData {
  if (!existsSync(file)) return { delegates: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PriorPersistedData;
    if (parsed.delegates && typeof parsed.delegates === 'object') {
      return {
        delegates: parsed.delegates,
        activeDelegateId: parsed.activeDelegateId,
      };
    }
    if (parsed.session) {
      return {
        delegates: { active: parsed.session },
        activeDelegateId: 'active',
      };
    }

    // Preserve a sole delegate created by earlier single-user server versions.
    const priorSessions = Object.values(parsed.sessions ?? {});
    if (priorSessions.length === 1) {
      return {
        delegates: { active: priorSessions[0] },
        activeDelegateId: 'active',
      };
    }
  } catch {
    // Fall through to a fresh store.
  }
  return { delegates: {} };
}

function save(file: string, data: PersistedData): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(tmp, file);
}

export function makeStateStore(
  file: string = DEFAULT_STATE_FILE,
): StateStore {
  const data: PersistedData = load(file);
  const delegates = new Map(Object.entries(data.delegates));

  function persist(): void {
    data.delegates = Object.fromEntries(delegates);
    save(file, data);
  }

  const store: StateStore = {
    createActiveDelegate(mnemonic: string, address: string): string {
      const delegateId = crypto.randomUUID();
      delegates.set(delegateId, { mnemonic, address });
      data.activeDelegateId = delegateId;
      persist();
      return delegateId;
    },

    getActiveDelegate(): DelegateState | undefined {
      if (!data.activeDelegateId) return undefined;
      return delegates.get(data.activeDelegateId);
    },

    updateActiveDelegate(updates: Partial<DelegateState>): boolean {
      const activeDelegate = store.getActiveDelegate();
      if (!activeDelegate) return false;
      Object.assign(activeDelegate, updates);
      persist();
      return true;
    },
  };

  return store;
}

export const defaultStateStore = makeStateStore();
