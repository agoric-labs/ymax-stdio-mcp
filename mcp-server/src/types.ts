export interface DelegateState {
  mnemonic: string;
  /** Derivation path for `mnemonic`; absent means DEFAULT_HD_PATH. */
  hdPath?: string;
  address: string;
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
  isError?: boolean;
  _meta?: Record<string, unknown>;
}
