const DEFAULT_YDS_URL = 'https://main0.ymax.app';

export interface RegistrationOptions {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
}

export async function registerTransaction(
  params: {
    txHash: string;
    portfolioId: number;
    flowKey?: string;
  },
  options: RegistrationOptions,
): Promise<{ success: boolean }> {
  const { txHash, portfolioId, flowKey } = params;
  const ydsUrl = options.env.YDS_URL || DEFAULT_YDS_URL;

  const body: Record<string, unknown> = {
    txHash,
    portfolioId,
  };
  if (flowKey) body.flowKey = flowKey;

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
