// RAD-158 PR 2b (M5-10; ADR-009 §4, §10; ADR-010 §4; the architect's ruling (a)) on a real PostgreSQL, as the runtime
// login: TDS deducted at booking. F29 through expenses on credit, each supplier the test's own, so the year's rows are
// its own: section 194C-I at 1%, single 30,000.00, yearly 1,00,000.00, no-PAN 20% (0104's seed). What the supplier is
// owed is the bill less the TDS, and payments apply to that; a cancel leaves the year's base; F12 paid by bank; an
// overseas supplier takes no section.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  addExpense, addExpenseCategory, addParty, allocatePayment, cancelExpenseNow, depositTds, getExpenseById, journalEntryById, journalPage, openFinancialYear,
  postExpenseNow, recordPayment, tdsDeductionsPage,
} from '@radcore/lib-accounts';
import { createExpense, recordPaymentContract } from '@radcore/lib-accounts/contract';
import { gstinCheckChar, moneyString } from '@radcore/lib-common';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['expenses:read', 'expenses:write', 'accounts:write', 'parties:write',
  'payments:write', 'journal:read'] };
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const digits = () => String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0');
const individualPan = () => `${letters(3)}P${letters(1)}${digits()}${letters(1)}`;
const DAYS = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the TDS booking tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('TDS at booking', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? String(e)));
  const one = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => (await su.query<T>(text, values)).rows[0];
  const sectionId = async (c: string) => (await one<{ id: string }>('select id from radcore.tds_sections where code = $1', [c]))?.id ?? '';
  const systemAccount = async (key: string) => (await one<{ id: string }>('select id from radcore.accounts where system_key = $1', [key]))?.id ?? '';
  const file = async () => (await one<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
    insert into radcore.files (kind, store_key, filename, content_type, size, status) select 'expense_bill', $1, 'bill.pdf', 'application/pdf', 2048, 'ready'
    from p returning id`, [`expense_bill/${randomUUID()}`]))?.id ?? '';

  /** A supplier (unregistered with an individual's PAN, unless said) and an expense category on a new expense head. */
  async function setup(o: { pan?: string | null; gstin?: boolean; overseas?: boolean } = {}) {
    const head = await one<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.accounts (name, type) select $1, 'expense' from p returning id`, [`Contract labour ${letters(6)}`]);
    const accountId = head?.id ?? '';
    return run(async (ctx) => {
      for (const d of DAYS) await openFinancialYear(ctx, d);
      const first14 = `27${letters(3)}C${letters(1)}${digits()}${letters(1)}1Z`;
      const gstin = o.gstin === true ? `${first14}${gstinCheckChar(first14)}` : null;
      const { id: partyId } = await addParty(ctx, { name: `Contractor ${letters(6)}`, kinds: ['supplier'], gstin,
        pan: o.overseas === true ? null : gstin === null ? (o.pan === undefined ? individualPan() : o.pan) : gstin.slice(2, 12), composition: false,
        stateCode: o.overseas === true ? '96' : '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null,
        ...(o.overseas === true ? { overseas: true } : {}) });
      const { id: categoryId } = await addExpenseCategory(ctx, { name: `Labour ${letters(6)}`, credit: 'allowed', blockedClause: null, accountIds: [accountId] });
      return { partyId, gstin, categoryId, accountId };
    });
  }
  type At = Awaited<ReturnType<typeof setup>>;
  /** An expense of `base` (GST at `rate`), on credit unless `pay` names a money account, under `section`. */
  const book = async (at: At, base: string, o: { day: string; section: string | null; pay?: string; rate?: string }) => {
    const rate = o.rate ?? '0';
    const half = moneyString().parse(String(Number(base) * Number(rate) / 200));
    const total = String(Number(base) + 2 * Number(half));
    const input = createExpense.input.parse({ businessDate: o.day, supplierId: at.partyId, supplierInvoiceNumber: `B/${letters(5)}`, supplierInvoiceDate: o.day,
      supplierGstin: at.gstin, payFromAccountId: o.pay ?? null, statedTotal: total, fileId: await file(), notes: null,
      lines: [{ categoryId: at.categoryId, accountId: at.accountId, description: null, taxable: base, gstRate: rate, cgst: half, sgst: half, igst: '0',
        tdsSectionId: o.section }] });
    return run(async (ctx) => {
      const { id } = await addExpense(ctx, input);
      await postExpenseNow(ctx, { id });
      return id;
    });
  };
  const deducted = async (id: string) => (await one<{ v: string }>(`select coalesce(sum(amount), 0)::numeric(18, 2)::text as v from radcore.tds_deductions
    where source_id = $1`, [id]))?.v;
  const entryOf = (id: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DAYS[0] ?? '', to: '2026-11-30', kind: 'expense' } });
    const e = page.items.find((x) => x.source.id === id && x.reversesEntryId === null);
    return (await journalEntryById(ctx, { id: e?.id ?? '' })).lines.map((l) => `${l.account.name.replace(/ [A-Z]{6}$/, '')} ${l.debit} ${l.credit}`).sort();
  });

  it('F29: nothing under both limits, 1,030.00 on the bill crossing the yearly one, 100.00 after; the supplier is owed the bill less it', async () => {
    const [at, section] = [await setup(), await sectionId('194C-I')];
    const april = await book(at, '25000', { day: DAYS[0] ?? '', section });
    const may = await book(at, '28000', { day: DAYS[1] ?? '', section });
    const june = await book(at, '50000', { day: DAYS[2] ?? '', section });
    const july = await book(at, '10000', { day: DAYS[3] ?? '', section });
    expect([await deducted(april), await deducted(may), await deducted(june), await deducted(july)]).toEqual(['0.00', '0.00', '1030.00', '100.00']);
    expect(await entryOf(june)).toEqual(['Contract labour 50000.00 0.00', 'Creditors 0.00 48970.00', 'TDS Payable 0.00 1030.00'].sort());
    expect((await run((ctx) => getExpenseById(ctx, { id: june }))).tds).toBe('1030.00');
    // The ruling's case: a payment applies to the 48,970.00 owed, not a paisa more.
    const bank = await systemAccount('bank');
    const pay = (amount: string) => run(async (ctx) => {
      const { id } = await recordPayment(ctx, recordPaymentContract.input.parse({ kind: 'payment', partyId: at.partyId, businessDate: DAYS[3], amount,
        accountId: bank }));
      await allocatePayment(ctx, { id, businessDate: DAYS[3] ?? '', lines: [{ documentTable: 'expenses', documentId: june, amount: moneyString().parse(amount) }] });
    });
    expect(await code(pay('48970.01'))).toBe('allocation_exceeds_document');
    expect(await code(pay('48970'))).toBe('ok');
  });

  it('F29’s variant: with no PAN the June bill deducts 20,600.00, each booking at 20%', async () => {
    const [at, section] = [await setup({ pan: null }), await sectionId('194C-I')];
    await book(at, '25000', { day: DAYS[0] ?? '', section });
    await book(at, '28000', { day: DAYS[1] ?? '', section });
    const june = await book(at, '50000', { day: DAYS[2] ?? '', section });
    expect(await deducted(june)).toBe('20600.00');
    const rows = (await su.query('select rate::text, no_pan_rate from radcore.tds_deductions where party_id = $1 order by business_date', [at.partyId])).rows;
    expect(rows.map((r) => [r.rate, r.no_pan_rate])).toEqual([['20.000000', true], ['20.000000', true], ['20.000000', true]]);
  });

  it('leaves a cancelled booking out of the year: its rows reversed, the next bill judged without it', async () => {
    const [at, section] = [await setup(), await sectionId('194C-I')];
    await book(at, '25000', { day: DAYS[0] ?? '', section });
    await book(at, '28000', { day: DAYS[1] ?? '', section });
    const june = await book(at, '50000', { day: DAYS[2] ?? '', section });
    await run((ctx) => cancelExpenseNow(ctx, { id: june, businessDate: DAYS[2] ?? '', reason: 'Entered twice' }));
    expect(await deducted(june)).toBe('0.00');
    // 25,000 + 28,000 + 10,000 is under both limits once June is gone.
    expect(await deducted(await book(at, '10000', { day: DAYS[3] ?? '', section }))).toBe('0.00');
  });

  it('posts F12: a professional fee paid by bank, Cr Bank 64,800.00 and TDS Payable 6,000.00', async () => {
    const [at, section] = [await setup({ gstin: true }), await sectionId('194J-P')];
    const id = await book(at, '60000', { day: DAYS[0] ?? '', section, pay: await systemAccount('bank'), rate: '18' });
    expect(await entryOf(id)).toEqual(['Bank 0.00 64800.00', 'Contract labour 60000.00 0.00', 'Input CGST 5400.00 0.00', 'Input SGST 5400.00 0.00',
      'TDS Payable 0.00 6000.00'].sort());
  });

  it('applies an advance paid with TDS at what it debits Creditors, the cash and its TDS (the architect on RAD-158)', async () => {
    const at = await setup();
    const id = await book(at, '50000', { day: DAYS[0] ?? '', section: null });
    await run(async (ctx) => {
      const { id: payment } = await recordPayment(ctx, recordPaymentContract.input.parse({ kind: 'payment', partyId: at.partyId, businessDate: DAYS[0],
        amount: '50000', tds: '500', accountId: await systemAccount('bank') }));
      await allocatePayment(ctx, { id: payment, businessDate: DAYS[0] ?? '', lines: [{ documentTable: 'expenses', documentId: id, amount: moneyString().parse('50000') }] });
    });
    expect((await one<{ v: string }>(`select coalesce(sum(case direction when 'apply' then amount else -amount end), 0)::numeric(18, 2)::text as v
      from radcore.payment_allocations where document_table = 'expenses' and document_id = $1`, [id]))?.v).toBe('50000.00');
  });

  // The architect on #452: a section for individuals needs a PAN whose 4th letter is P or H; with no PAN any section is
  // allowed at the no-PAN rate (F29's variant above).
  it('refuses an individual’s section for a company’s PAN (tds_payee_mismatch), and takes it for an individual’s', async () => {
    const section = await sectionId('194C-I');
    const company = await setup({ pan: `${letters(3)}C${letters(1)}${digits()}${letters(1)}` });
    expect(await code(book(company, '40000', { day: DAYS[0] ?? '', section }))).toBe('tds_payee_mismatch');
    expect(await code(book(company, '40000', { day: DAYS[0] ?? '', section: await sectionId('194C-O') }))).toBe('ok');
    expect(await deducted(await book(await setup(), '40000', { day: DAYS[0] ?? '', section }))).toBe('400.00');
  });

  // F18 (ADR-009 §4): a challan pays deductions in full, each once: Dr TDS Payable, Cr Bank. A booking whose TDS is
  // deposited isn't cancelled (its correction waits on CA-22).
  it('deposits F29’s 1,030.00 by challan (Dr TDS Payable, Cr Bank), once, and then refuses the bill’s cancel', async () => {
    const [at, section, bank] = [await setup(), await sectionId('194C-I'), await systemAccount('bank')];
    const april = await book(at, '25000', { day: DAYS[0] ?? '', section });
    await book(at, '28000', { day: DAYS[1] ?? '', section });
    const june = await book(at, '50000', { day: DAYS[2] ?? '', section });
    const rowOf = async (id: string) => (await one<{ id: string }>('select id from radcore.tds_deductions where source_id = $1', [id]))?.id ?? '';
    const [zero, due] = [await rowOf(april), await rowOf(june)];
    const open = await run((ctx) => tdsDeductionsPage(ctx, { limit: 500, filter: { open: true } }));
    expect([open.items.some((d) => d.id === due), open.items.some((d) => d.id === zero)]).toEqual([true, false]);
    const deposit = (ids: string[], accountId = bank) => run((ctx) => depositTds(ctx, { businessDate: DAYS[3] ?? '', challanNumber: `C${letters(5)}`,
      bsrCode: '0510002', accountId, deductionIds: ids }));
    expect(await code(deposit([zero]))).toBe('nothing_to_deposit');
    expect(await code(deposit([due], await systemAccount('cash')))).toBe('not_bank_account');
    const { id } = await deposit([due]);
    const lines = await run(async (ctx) => {
      const page = await journalPage(ctx, { limit: 100, filter: { from: DAYS[3] ?? '', to: DAYS[3] ?? '', kind: 'tds_deposit' } });
      return (await journalEntryById(ctx, { id: page.items.find((e) => e.source.id === id)?.id ?? '' })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`).sort();
    });
    expect(lines).toEqual(['Bank 0.00 1030.00', 'TDS Payable 1030.00 0.00']);
    expect(await code(deposit([due]))).toBe('already_deposited');
    expect(await code(run((ctx) => cancelExpenseNow(ctx, { id: june, businessDate: DAYS[3] ?? '', reason: 'Wrong' })))).toBe('tds_deposited');
  });

  it('refuses a TDS section on an overseas supplier’s line (tds_overseas, ADR-010 §4)', async () => {
    const [at, section] = [await setup({ overseas: true }), await sectionId('194J-T')];
    expect(await code(book(at, '10000', { day: DAYS[0] ?? '', section }))).toBe('tds_overseas');
  });
});
