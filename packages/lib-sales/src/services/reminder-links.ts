// A payment reminder with a link to the party's oldest overdue invoice (M3-15, RAD-119; the architect's ruling).
// lib-accounts records the reminder and keeps only the link's id; the link is an invoice link (RAD-118), made here
// because lib-accounts can't reach lib-sales. apps/api mounts this on lib-accounts' recordReminder contract.
import { invoices, salesTx } from '@radcore/db/sales';
import { remind, type ReminderLinkFor } from '@radcore/lib-accounts';
import type { Ctx } from '@radcore/lib-platform';
import { inArray } from 'drizzle-orm';
import { shareInvoiceLink } from './invoice-links.ts';

type RemindInput = Parameters<typeof remind>[1];

/** The oldest-due open bill that's an invoice: a new link to it if the person may share it, else why not. */
const invoiceLink: ReminderLinkFor = async (ctx, bills) => {
  const ids = bills.filter((b) => b.table === 'invoices').map((b) => b.id);
  const rows = ids.length === 0 ? [] : await salesTx(ctx).select({ id: invoices.id, owner: invoices.owner }).from(invoices).where(inArray(invoices.id, ids));
  const oldest = ids.map((id) => rows.find((r) => r.id === id)).find((r) => r !== undefined);
  if (oldest === undefined) return { link: null, noLink: 'not_an_invoice' };
  if (!ctx.can('invoices:share', { owner: oldest.owner })) return { link: null, noLink: 'no_share_key' };
  const { id, path, expiresAt } = await shareInvoiceLink(ctx, { id: oldest.id });
  return { link: { id, path, expiresAt }, noLink: null };
};

/** POST /parties/:id/reminders, on lib-accounts' recordReminder contract. */
export const remindWithLink = (ctx: Ctx, input: RemindInput) => remind(ctx, input, invoiceLink);
