export interface SessionState {
  mnemonic: string;
  address: string;
  portfolioId?: number;
  delegationKeyName?: string;
}

export interface AllocationMap {
  [instrument: string]: number;
}

export interface ToolResponse {
  content: { type: 'text'; text: string }[];
  _meta?: Record<string, unknown>;
}
