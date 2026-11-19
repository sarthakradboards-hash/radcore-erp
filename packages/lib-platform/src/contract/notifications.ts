// The notification contracts (M3-17, RAD-121), re-exported by ../contract.ts. Like every contract file it imports only
// zod and lib-common (D5), so the browser can load it. Each person reads and marks only their own, under /me, with
// session:read, the key every role holds. The bell asks for the unread count every minute, as the shell asks for /me
// (apps/web's REFRESH_MS).
import { defineContract, idString, listInput, listOf, momentString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** GET /me/notifications/unread: how many of the person's own are unread. */
export const countMyNotifications = defineContract({
  method: 'GET', path: '/me/notifications/unread', auth: 'session', perm: 'session:read', tx: read,
  input: z.object({}), output: z.object({ unread: z.number().int().min(0) }),
});

/** GET /me/notifications: the person's own, newest first, a page at a time; `unread` keeps only the unread. Each holds
 * its kind and the record's table and id, and text built for the person when it's read, never a copy of the record. */
export const listMyNotifications = defineContract({
  method: 'GET', path: '/me/notifications', auth: 'session', perm: 'session:read', tx: read,
  input: listInput(z.object({ unread: z.boolean().optional() })),
  output: listOf(z.object({
    id: idString(), kind: z.string(), record: z.object({ table: z.string(), id: idString() }), text: z.string(),
    at: momentString(), readAt: momentString().nullable(),
  })),
});

/** POST /me/notifications/read: marks these of the person's own read, up to 200, or every unread one when no ids are
 * sent. Answers how many it marked. */
export const markMyNotificationsRead = defineContract({
  method: 'POST', path: '/me/notifications/read', auth: 'session', perm: 'session:read', tx: write,
  input: z.object({ ids: z.array(idString()).min(1).max(200).optional() }),
  output: z.object({ marked: z.number().int().min(0) }),
});
