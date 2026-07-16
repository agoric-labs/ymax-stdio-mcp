import type { ToolResponse } from './types.ts';

export const toolError = (message: string): ToolResponse => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});
