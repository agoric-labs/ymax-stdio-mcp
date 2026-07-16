export interface TransactionRegistrationIO {
  fetch: typeof globalThis.fetch;
  ydsUrl: string;
  chainId: string;
  ymaxInstance: string;
}

export async function registerTransaction(
  params: { txHash: string },
  io: TransactionRegistrationIO,
): Promise<{ success: boolean }> {
  const { txHash } = params;

  const response = await io.fetch(`${io.ydsUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txHash,
      chain: io.chainId,
      ymaxInstance: io.ymaxInstance,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Transaction registration failed (${response.status}): ${text}`,
    );
  }

  return { success: true };
}
