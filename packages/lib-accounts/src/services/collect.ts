// What parties owe (M3-15, RAD-119): a party's statement and the To collect list, from the Debtors lines and what's
// been paid on each bill (allocations and credits, v_document_paid), with rules/collect.ts doing the sums. A bill is an
// invoice's entry; it's due the party's credit days after its date, else accounts.default_credit_days.
import { accounts, accountsTx, journalEntries, journalLines, parties, paymentReminders } from '@radcore/db/accounts';
import { vSalesDocumentRefs } from '@radcore/db/views';
import { dec, ENTRY_KINDS, indiaDate } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray, isNotNull, lte, max } from 'drizzle-orm';
import { z } from 'zod';
import type { getPartyStatement, listToCollect } from '../contract.ts';
import { collect, openBills, statement, type PartyLine } from '../rules/collect.ts';
import { paidOf } from './allocations.ts';
import { DEFAULT_CREDIT_DAYS } from './payments.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** The kinds of entry whose Debtors debit is a bill to collect. */
const BILL_KINDS = new Set(['invoice']);
const today = () => indiaDate(new Date());
const entryKind = z.enum(ENTRY_KINDS);

/** Debtors lines up to `on`, oldest first, each with its entry's number, kind and document; for these parties, or all. */
async function debtorsLines(ctx: Ctx, on: string, partyIds?: readonly string[]) {
  return accountsTx(ctx).select({ partyId: journalLines.partyId, entryId: journalLines.entryId, reversesEntryId: journalEntries.reversesEntryId,
    entryNumber: journalEntries.number, documentNumber: vSalesDocumentRefs.number, kind: journalEntries.kind, businessDate: journalLines.businessDate, sourceTable: journalEntries.sourceTable,
    sourceId: journalEntries.sourceId, debit: journalLines.debit, credit: journalLines.credit }).from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId)).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    // A sales document's own number, through its view (ADR-001 §5): lib-accounts reads no sales table.
    .leftJoin(vSalesDocumentRefs, and(eq(vSalesDocumentRefs.documentTable, journalEntries.sourceTable),
      eq(vSalesDocumentRefs.documentId, journalEntries.sourceId)))
    .where(and(eq(accounts.systemKey, 'debtors'), lte(journalLines.businessDate, on), isNotNull(journalLines.partyId),
      partyIds === undefined ? undefined : inArray(journalLines.partyId, [...partyIds])))
    .orderBy(asc(journalLines.businessDate), asc(journalLines.postedAt), asc(journalLines.id));
}

/** What's been paid on each bill these lines name, by table and id. */
async function paidOnBills(ctx: Ctx, lines: readonly PartyLine[]) {
  const byTable = new Map<string, Set<string>>();
  for (const l of lines) if (BILL_KINDS.has(l.kind)) byTable.set(l.sourceTable, (byTable.get(l.sourceTable) ?? new Set()).add(l.sourceId));
  const paid = new Map<string, string>();
  for (const [table, ids] of byTable) {
    for (const [id, p] of await paidOf(ctx, table, [...ids])) paid.set(`${table}:${id}`, p.paid);
  }
  return (table: string, id: string) => paid.get(`${table}:${id}`) ?? '0';
}

const isBillOf = (lines: readonly PartyLine[]) => {
  const tables = new Set(lines.filter((l) => BILL_KINDS.has(l.kind)).map((l) => l.sourceTable));
  return (table: string) => tables.has(table);
};

/** What a party owes today: its Debtors lines to today, its open bills and the sums (for its statement and a reminder). */
export async function partyOwed(ctx: Ctx, id: string) {
  const [party] = await accountsTx(ctx).select({ id: parties.id, name: parties.name, creditDays: parties.creditDays }).from(parties)
    .where(eq(parties.id, id)).limit(1);
  if (party === undefined) throw new AppError('not_found', 'There is no such party');
  const on = today();
  const lines = await debtorsLines(ctx, on, [id]);
  const creditDays = party.creditDays ?? ctx.settings.get(DEFAULT_CREDIT_DAYS);
  const bills = openBills(lines, { isBill: isBillOf(lines), paid: await paidOnBills(ctx, lines), creditDays, today: on });
  return { party: { id: party.id, name: party.name, creditDays }, lines, bills, owed: collect(lines, bills) };
}

/** GET /parties/:id/statement. Nothing posts after today, so today's lines hold the range asked for; the open bills and
 * what's owed are today's. */
export async function partyStatement(ctx: Ctx, { id, from, to }: In<typeof getPartyStatement>): Promise<Out<typeof getPartyStatement>> {
  const { party, lines, bills, owed } = await partyOwed(ctx, id);
  const s = statement(lines, from, to);
  return { party, opening: s.opening, closing: s.closing,
    lines: s.lines.map((l) => ({ businessDate: l.businessDate, entryNumber: l.entryNumber, documentNumber: l.documentNumber, kind: entryKind.parse(l.kind), sourceTable: l.sourceTable,
      sourceId: l.sourceId, debit: l.debit, credit: l.credit, balance: l.balance })),
    openBills: bills, toCollect: owed };
}

/** GET /to-collect: every party owing something today, most overdue first, then most owed, then by name.
 * shortcut: every party's Debtors lines are read and summed here, then paged by position; a summary table or a
 * grouped query takes over when the parties owing run into the thousands. */
export async function toCollectPage(ctx: Ctx, { after, limit }: In<typeof listToCollect>): Promise<Out<typeof listToCollect>> {
  const on = today();
  const lines = await debtorsLines(ctx, on);
  const byParty = Map.groupBy(lines, (l) => l.partyId ?? '');
  const ids = [...byParty.keys()];
  const known = ids.length === 0 ? [] : await accountsTx(ctx).select({ id: parties.id, name: parties.name, creditDays: parties.creditDays })
    .from(parties).where(inArray(parties.id, ids));
  const paid = await paidOnBills(ctx, lines);
  const isBill = isBillOf(lines);
  const fallback = ctx.settings.get(DEFAULT_CREDIT_DAYS);
  const reminded = new Map(ids.length === 0 ? [] : (await accountsTx(ctx).select({ partyId: paymentReminders.partyId, at: max(paymentReminders.asAt) })
    .from(paymentReminders).where(inArray(paymentReminders.partyId, ids)).groupBy(paymentReminders.partyId)).map((r) => [r.partyId, r.at]));
  const rows = known.map((p) => {
    const own = byParty.get(p.id) ?? [];
    const owed = collect(own, openBills(own, { isBill, paid, creditDays: p.creditDays ?? fallback, today: on }));
    return { partyId: p.id, name: p.name, ...owed, lastReminderAt: reminded.get(p.id)?.toISOString() ?? null };
  }).filter((r) => dec(r.outstanding).gt(0))
    .toSorted((a, b) => dec(b.overdue).cmp(a.overdue) || dec(b.outstanding).cmp(a.outstanding) || a.name.localeCompare(b.name));
  const start = after === undefined ? 0 : Number(after);
  const items = rows.slice(start, start + limit);
  return { items, next: start + limit < rows.length ? String(start + limit) : null };
}
