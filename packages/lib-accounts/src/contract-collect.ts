// What parties owe (M3-15, RAD-119): a party's statement and the To collect list, re-exported by ./contract. A party's
// balance and open bills are behind receivables:read, never parties:read (RC-042). Like every contract file it imports
// only zod and lib-common (D5).
import {
  dateString, defineContract, ENTRY_KINDS, idString, listInput, listOf, momentString, moneyString, principalOut,
} from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;

/** What there is to collect from a party: its balance, what of it is overdue and since when, and what isn't on a bill
 * (an opening balance, a manual journal, a payment applied to no bill), so the open bills and it add up to the balance. */
const owed = z.object({ outstanding: moneyString({ signed: true }), overdue: moneyString(), oldestDue: dateString().nullable(),
  notOnABill: moneyString({ signed: true }) });

/** GET /parties/:id/statement (receivables:read): the party's Debtors lines from `from` to `to`, each with the balance
 * after it, between the balance before `from` and the last; then its open bills (each one's amount, what's paid on it
 * by allocations and credits, and when it's due), and what there is to collect today. */
export const getPartyStatement = defineContract({
  method: 'GET', path: '/parties/:id/statement', auth: 'session', perm: 'receivables:read', tx: read,
  input: z.object({ id: idString(), from: dateString(), to: dateString() })
    .refine((r) => r.from <= r.to, { error: 'The start date is after the end date', path: ['to'] }),
  output: z.object({
    party: z.object({ id: idString(), name: z.string(), creditDays: z.number().int() }),
    opening: moneyString({ signed: true }),
    // The entry's number, its document, and the document's own number (an invoice's), from v_sales_document_refs.
    lines: z.array(z.object({ businessDate: dateString(), entryNumber: z.string(), documentNumber: z.string().nullable(), kind: z.enum(ENTRY_KINDS), sourceTable: z.string(),
      sourceId: idString(), debit: moneyString(), credit: moneyString(), balance: moneyString({ signed: true }) })),
    closing: moneyString({ signed: true }),
    openBills: z.array(z.object({ table: z.string(), id: idString(), entryNumber: z.string(), documentNumber: z.string().nullable(), date: dateString(), due: dateString(),
      amount: moneyString(), paid: moneyString(), open: moneyString(), overdue: z.boolean() })),
    toCollect: owed,
  }),
});

/** GET /to-collect (receivables:read): every party that owes something today, most overdue first, then most owed. */
export const listToCollect = defineContract({
  method: 'GET', path: '/to-collect', auth: 'session', perm: 'receivables:read', tx: read,
  input: listInput(z.object({})),
  output: listOf(owed.extend({ partyId: idString(), name: z.string(), lastReminderAt: momentString().nullable() })),
});

const write = { readOnly: false, isolation: 'read committed' } as const;
/** How a reminder went. */
export const REMINDER_CHANNELS = ['whatsapp', 'phone', 'email', 'in_person'] as const;
const reminder = owed.omit({ notOnABill: true }).extend({ id: idString(), asAt: momentString(), channel: z.enum(REMINDER_CHANNELS),
  note: z.string().nullable() });

/** Why a reminder went without a link: the person may not share that invoice, or nothing owed is on an invoice. */
export const NO_LINK_REASONS = ['no_share_key', 'not_an_invoice'] as const;

/** POST /parties/:id/reminders (receivables:remind, and receivables:read, since it answers with the amounts): records a
 * reminder with what the party owes now, and answers with the text to send: the party's name and the amounts, nothing
 * of how to reach them (ADR-001 §7a). Sending it by WhatsApp waits for M7.
 * With it comes a new link to the party's oldest overdue invoice (RAD-118, the architect on RAD-119): its token is in
 * `link.path`'s fragment, in this answer only, so the answer is never kept. apps/api mounts it on lib-sales'
 * remindWithLink, which makes the link: lib-accounts can't reach lib-sales. */
export const recordReminder = defineContract({
  method: 'POST', path: '/parties/:id/reminders', auth: 'session', perm: 'receivables:remind', tx: write, storesAnswer: false,
  input: z.object({ id: idString(), channel: z.enum(REMINDER_CHANNELS), note: z.string().trim().min(1).max(500).optional() }),
  output: reminder.extend({ text: z.string(), link: z.object({ id: idString(), path: z.string(), expiresAt: momentString() }).nullable(),
    noLink: z.enum(NO_LINK_REASONS).nullable() }),
  errors: ['nothing_owed', 'wrong_status'],
});

/** GET /parties/:id/reminders (receivables:read): the party's reminders, the latest first, each with who made it. */
export const listReminders = defineContract({
  method: 'GET', path: '/parties/:id/reminders', auth: 'session', perm: 'receivables:read', tx: read,
  input: listInput(z.object({})).extend({ id: idString() }),
  output: listOf(reminder.extend({ by: principalOut })),
});
