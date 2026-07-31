import type { Registration } from './registration.ts';
import type { ToolResponse } from './types.ts';

export const toolError = (message: string): ToolResponse => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * Report a transaction that was broadcast and charged gas but whose action the
 * contract refused — an out-of-mandate allocation, for instance.
 *
 * The transaction hash is reported so the attempt stays traceable, and the
 * registration outcome travels with it: a rejected transaction is still real
 * chain activity and belongs on the activity page.
 */
export const submissionRejected = (
  payload: Record<string, unknown>,
  registration: Registration,
): ToolResponse => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        status: 'rejected',
        ...payload,
        registered: registration.registered,
        ...(registration.registered
          ? {}
          : { registrationError: registration.registrationError }),
      }),
    },
  ],
  isError: true,
});

/**
 * Report the outcome of a transaction that succeeded on-chain, alongside
 * whether YDS registration for activity-page visibility also succeeded.
 *
 * A registration failure is surfaced as a tool error so it cannot pass
 * unnoticed, but the payload retains the transaction hash and states plainly
 * that the chain action succeeded. Retrying the tool would broadcast a second
 * transaction; only the registration needs another attempt.
 */
export const registrationOutcome = (
  okStatus: string,
  payload: Record<string, unknown>,
  registration: Registration,
  action: string,
): ToolResponse => {
  if (registration.registered) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: okStatus,
            ...payload,
            registered: true,
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: `${okStatus}_unregistered`,
          ...payload,
          registered: false,
          registrationError: registration.registrationError,
          warning: `${action} SUCCEEDED on-chain; do NOT retry. Only YDS activity registration failed. Retry registration alone with POST /transactions.`,
        }),
      },
    ],
    isError: true,
  };
};
