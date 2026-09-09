import type { DelegateState } from './types.ts';

/**
 * Agoric's registered coin type. Delegates generated before this was pinned
 * derived from cosmjs's default (coin type 118) instead, and the owner granted
 * authority to that address. Such a delegate records its own `hdPath` so the
 * mnemonic still derives the address that actually holds the grant.
 */
export const DEFAULT_HD_PATH = "m/44'/564'/0'/0/0";

export const delegateHdPath = (delegate: DelegateState): string =>
  delegate.hdPath ?? DEFAULT_HD_PATH;
