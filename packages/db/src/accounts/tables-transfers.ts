// lib-accounts' transfers between the company's own money accounts (RAD-165's first PR; the architect on RAD-168;
// ADR-006 §6, F19). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { check, date, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { boundedText, createdMoment, id, money, radcoreTable } from '../columns.ts';
import { accounts, journalEntries } from './tables.ts';

/**
 * Money moved from one of our own accounts to another, such as cash paid into the bank (F19): Cash or Bank and those
 * under it, never the same one. A posted document (ADR-005 §7b): draft -> posted -> cancelled, posted as it's recorded,
 * its entry `transfer` (Dr the account it went to, Cr the one it came from); a cancel mirrors it, dated that day.
 */
export const transfers = radcoreTable('transfers', {
  id: id(), createdAt: createdMoment(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  businessDate: date({ mode: 'string' }).notNull(),
  fromAccountId: uuid().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  toAccountId: uuid().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  amount: money().notNull(),
  // What the bank calls it (a deposit slip, a UTR), for matching it to the statement later (M5-13).
  reference: boundedText({ max: 40 }),
  notes: boundedText({ max: 500 }),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_transfers_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_transfers_figures', sql`${t.amount} > 0 and ${t.fromAccountId} <> ${t.toAccountId}`),
  check('ck_transfers_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} = 'draft') = (${t.postedEntryId} is null)`),
  check('ck_transfers_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelEntryId} is not null)`),
  index('ix_transfers_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_transfers_from').on(t.fromAccountId),
  index('ix_transfers_to').on(t.toAccountId),
  index('ix_transfers_posted_entry').on(t.postedEntryId),
  index('ix_transfers_cancel_entry').on(t.cancelEntryId),
]);
