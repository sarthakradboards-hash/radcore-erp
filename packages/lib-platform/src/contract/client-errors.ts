// The browser's error report (RAD-29, RC-158), re-exported by ../contract.ts. Like every contract file it imports only
// zod and lib-common (D5), so the browser can load it. Public, so a signed-out page reports too, and counted per
// address (`client-error`). A read-only transaction: it stores nothing and needs no idempotency key.
import { defineContract } from '@radcore/lib-common';
import { z } from 'zod';

export const CLIENT_ERROR_KINDS = ['error', 'unhandledrejection', 'render'] as const;

export const reportClientError = defineContract({
  method: 'POST', path: '/client-errors', auth: 'public', rateLimit: 'client-error', perm: null,
  tx: { readOnly: true, isolation: 'read committed' } as const,
  input: z.object({
    kind: z.enum(CLIENT_ERROR_KINDS),
    // The error's class (TypeError), its message, the page's path and its stack, each as the browser has them.
    name: z.string().max(100),
    message: z.string().max(1000),
    page: z.string().max(500),
    stack: z.string().max(4000).optional(),
  }),
  output: z.object({}),
});
