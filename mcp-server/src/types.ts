import type { YmaxInstance } from './ymax-instance.ts';

export interface DelegateState {
  mnemonic: string;
  /** Derivation path for `mnemonic`; absent means DEFAULT_HD_PATH. */
  hdPath?: string;
  address: string;
  ymaxInstance?: YmaxInstance;
  portfolioId?: number;
  delegationKeyName?: string;
}

export interface AllocationMap {
  [instrument: string]: number;
}

export interface ProposalParams {
  [key: string]: number | string;
}

export interface ToolResponse {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}
