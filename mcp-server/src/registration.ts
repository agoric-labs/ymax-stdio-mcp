const YDS_URL = process.env.YDS_URL || 'https://main0.ymax.app';

export async function registerTransaction(params: {
  txHash: string;
  portfolioId: number;
  flowKey?: string;
}): Promise<{ success: boolean }> {
  const { txHash, portfolioId, flowKey } = params;

  const body: Record<string, unknown> = {
    txHash,
    portfolioId,
  };
  if (flowKey) body.flowKey = flowKey;

  const response = await fetch(`${YDS_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Transaction registration failed (${response.status}): ${text}`,
    );
  }

  return { success: true };
}
