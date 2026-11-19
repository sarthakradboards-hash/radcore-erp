// RAD-121 (M3-17): the notification contracts. Each person reads and marks only their own, under /me, with the key
// every role holds; a notification answers its kind, the record's table and id, and text built for the viewer.
import { describe, expect, it } from 'vitest';
import { countMyNotifications, listMyNotifications, markMyNotificationsRead } from './notifications.ts';

const ID = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';

describe('the notification contracts', () => {
  it('live under /me with session:read, the two reads read-only and mark-read a write', () => {
    expect([countMyNotifications, listMyNotifications, markMyNotificationsRead].map((c) => `${c.method} ${c.path} ${c.perm} ${c.tx.readOnly}`))
      .toEqual(['GET /me/notifications/unread session:read true', 'GET /me/notifications session:read true',
        'POST /me/notifications/read session:read false']);
  });

  it('mark some by id, up to 200, or every unread one when no ids are sent', () => {
    const ok = (input: unknown) => markMyNotificationsRead.input.safeParse(input).success;
    expect([ok({}), ok({ ids: [ID] }), ok({ ids: [] }), ok({ ids: ['x'] }), ok({ ids: Array.from({ length: 201 }, () => ID) })])
      .toEqual([true, true, false, false, false]);
  });

  it('answer references and text, never a copy of the record', () => {
    const item = { id: ID, kind: 'crm.repeat_enquiry', record: { table: 'leads', id: ID }, text: 'Asha enquired again',
      at: '2026-11-19T08:30:00.000Z', readAt: null };
    expect(listMyNotifications.output.safeParse({ items: [item], next: null }).success).toBe(true);
    expect(Object.keys(listMyNotifications.output.parse({ items: [{ ...item, phone: '98' }], next: null }).items[0] ?? {}))
      .not.toContain('phone');
    expect(countMyNotifications.output.safeParse({ unread: 3 }).success).toBe(true);
  });
});
