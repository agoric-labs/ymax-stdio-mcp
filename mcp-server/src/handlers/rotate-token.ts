import { rotateToken } from '../state.ts';
import type { ToolResponse } from '../types.ts';

export async function handleRotateToken(
  bearerToken: string,
): Promise<ToolResponse> {
  const newToken = rotateToken(bearerToken);
  if (!newToken) {
    return { content: [{ type: 'text', text: 'unauthorized' }] };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ newBearerToken: newToken }),
      },
    ],
  };
}
