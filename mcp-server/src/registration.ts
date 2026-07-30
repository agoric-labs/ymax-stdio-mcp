const DEFAULT_YDS_URL = 'https://main0.ymax.app';

export interface RegistrationOptions {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
}

export type Registration =
  | { registered: true }
  | { registered: false; registrationError: string };

/**
 * Register a broadcast transaction, capturing failure rather than throwing.
 *
 * Registration affects only activity-page visibility, so its failure must never
 * discard the outcome of a transaction that already succeeded on-chain.
 */
export async function attemptRegistration(
  params: {
    txHash: string;
    chain: string;
    ymaxInstance: string;
  },
  options: RegistrationOptions,
): Promise<Registration> {
  return registerTransaction(params, options).then(
    (): Registration => ({ registered: true }),
    (err: Error): Registration => {
      console.error('tx registration failed:', err.message);
      return { registered: false, registrationError: err.message };
    },
  );
}

export async function registerTransaction(
  params: {
    txHash: string;
    chain: string;
    ymaxInstance: string;
  },
  options: RegistrationOptions,
): Promise<{ success: boolean }> {
  const { txHash, chain, ymaxInstance } = params;
  const ydsUrl = options.env.YDS_URL || DEFAULT_YDS_URL;

  // POST /transactions requires all three fields; YDS resolves the portfolio
  // from the transaction itself, so portfolioId is not part of the request.
  const body: Record<string, unknown> = {
    txHash,
    chain,
    ymaxInstance,
  };
  const response = await options.fetch(`${ydsUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Transaction registration failed (${response.status}): ${text}`,
    );
  }

  return { success: true };
}
