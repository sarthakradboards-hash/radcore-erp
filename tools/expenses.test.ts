// RAD-152 (M5-02; ADR-009 §2, §3, §10; ADR-006 F27, F28; ADR-007 §8) on a real PostgreSQL, as the runtime login: expenses.
// Each test makes its own suppliers, expense accounts and categories. The company is in Maharashtra (27), as
// tools/test-database.ts makes it. F27: a blocked category claims nothing; F28: an out-of-state hotel's CGST and SGST
// claim nothing, while its IGST variant does; the database holds a line to its category's accounts; cash past the
// day's limit waits for an owner's override.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  addExpense, addExpenseCategory, addParty, cancelExpenseNow, changeExpense, changeExpenseCategory, expenseCashSpec, getExpenseById, journalEntryById,
  journalPage, openFinancialYear, postExpenseNow, recordPayment,
} from '@radcore/lib-accounts';
import { createExpense, recordPaymentContract } from '@radcore/lib-accounts/contract';
import { gstinCheckChar } from '@radcore/lib-common';
import { AppError, decideApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-16';
const KEYS = ['expenses:read', 'expenses:write', 'accounts:write', 'journal:read', 'parties:write', 'payments:write'];
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const gstin = (state: string) => {
  const first14 = `${state}${letters(3)}C${letters(1)}${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}${letters(1)}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};

it('refuses unequal CGST and SGST, and IGST beside them, in the contract, not as a 500 from the CHECK (the auditor on #435)', () => {
  const line = (heads: Record<string, string>) => ({ categoryId: randomUUID(), accountId: randomUUID(), description: null, taxable: '1000', gstRate: '18',
    cgst: '0', sgst: '0', igst: '0', ...heads });
  const input = (l: object) => ({ businessDate: DATE, supplierId: null, supplierInvoiceNumber: 'A', supplierInvoiceDate: DATE, supplierGstin: null,
    payFromAccountId: randomUUID(), statedTotal: '1180', fileId: null, notes: null, lines: [l] });
  expect(createExpense.input.safeParse(input(line({ cgst: '90', sgst: '90' }))).success).toBe(true);
  expect(createExpense.input.safeParse(input(line({ cgst: '90', sgst: '91' }))).success).toBe(false);
  expect(createExpense.input.safeParse(input(line({ cgst: '90', sgst: '90', igst: '180' }))).success).toBe(false);
});

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the expense tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('expenses', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? (e as { constraint?: string }).constraint ?? String(e)));
  const owner = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  };
  // A person made now, as the approval engine reads their account's age (RAD-38).
  const person = async (permissions = [...KEYS, 'payments:approve']): Promise<Principal> => {
    const role = `t_${letters(10).toLowerCase()}`;
    await owner("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [role]);
    const [u] = await owner<{ id: string }>("insert into radcore.users (email, display_name, role) values ($1, 'Test person', $2) returning id",
      [`expenses-${randomUUID()}@example.test`, role]);
    return { kind: 'user', userId: u?.id ?? '', permissions, ownScope: [], role };
  };
  const file = async () => (await owner<{ id: string }>(`insert into radcore.files (kind, store_key, filename, content_type, size, status)
    values ('expense_bill', $1, 'bill.pdf', 'application/pdf', 2048, 'ready') returning id`, [`expense_bill/${randomUUID()}`]))[0]?.id ?? '';
  const account = async (name: string) => (await owner<{ id: string }>("insert into radcore.accounts (name, type) values ($1, 'expense') returning id",
    [`${name} ${letters(6)}`]))[0]?.id ?? '';
  const systemAccount = async (key: string) => (await su.query<{ id: string }>('select id from radcore.accounts where system_key = $1', [key])).rows[0]?.id ?? '';

  type Setup = { staff: Principal; supplier: string; supplierGstin: string; accountId: string; categoryId: string };
  /** A supplier of `state` (registered unless said), an expense account named `name` and a category on it. */
  async function setup(o: { state: string; name: string; blocked?: string }): Promise<Setup> {
    const staff = await person();
    const supplierGstin = gstin(o.state);
    const accountId = await account(o.name);
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: supplier } = await addParty(ctx, { name: `Supplier ${letters(6)}`, kinds: ['supplier'], gstin: supplierGstin, pan: null,
        composition: false, stateCode: o.state, phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      const { id: categoryId } = await addExpenseCategory(ctx, { name: `${o.name} ${letters(6)}`, credit: o.blocked === undefined ? 'allowed' : 'blocked',
        blockedClause: o.blocked ?? null, accountIds: [accountId] });
      return { supplier, categoryId };
    }, staff);
    return { staff, supplierGstin, accountId, ...made };
  }
  type Line = { taxable: string; gstRate: string; cgst?: string; sgst?: string; igst?: string };
  const draft = async (at: Setup, o: { lines: Line[]; total: string; pay: string | null; file?: boolean; supplier?: boolean }) => {
    const fileId = o.file === false ? null : await file();
    const input = createExpense.input.parse({ businessDate: DATE, supplierId: o.supplier === false ? null : at.supplier,
      supplierInvoiceNumber: `INV/${letters(5)}`, supplierInvoiceDate: DATE, supplierGstin: o.supplier === false ? null : at.supplierGstin,
      payFromAccountId: o.pay, statedTotal: o.total, fileId, notes: null,
      lines: o.lines.map((l) => ({ categoryId: at.categoryId, accountId: at.accountId, description: null, taxable: l.taxable, gstRate: l.gstRate,
        cgst: l.cgst ?? '0', sgst: l.sgst ?? '0', igst: l.igst ?? '0' })) });
    return (await run((ctx) => addExpense(ctx, input), at.staff)).id;
  };
  const post = (at: Setup, id: string) => run((ctx) => postExpenseNow(ctx, { id }), at.staff);
  const entryOf = (at: Setup, id: string, reversal = false) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: '2026-12-31', kind: 'expense' } });
    const e = page.items.find((x) => x.source.id === id && (x.reversesEntryId !== null) === reversal);
    return (await journalEntryById(ctx, { id: e?.id ?? '' })).lines.map((l) => `${l.account.name.replace(/ [A-Z]{6}$/, '')} ${l.debit} ${l.credit}`).sort();
  }, at.staff);
  const credit = async (id: string) => (await run((ctx) => getExpenseById(ctx, { id }), (await person()))).lines.map((l) => l.credit);

  // F27: staff lunch, 1,000.00 plus 5% from a Maharashtra restaurant, paid in cash; "Staff welfare" is blocked under 17(5)(b).
  it('posts F27: a blocked category claims nothing, Dr Staff Welfare 1,050.00, Cr Cash 1,050.00, numbered EX', async () => {
    const at = await setup({ state: '27', name: 'Staff Welfare', blocked: '(b)(i)' });
    const id = await draft(at, { lines: [{ taxable: '1000', gstRate: '5', cgst: '25', sgst: '25' }], total: '1050', pay: await systemAccount('cash') });
    const posted = await post(at, id);
    expect([posted.status, posted.number]).toEqual(['posted', expect.stringMatching(/^EX\//) as unknown]);
    expect(await entryOf(at, id)).toEqual(['Cash 0.00 1050.00', 'Staff Welfare 1050.00 0.00'].sort());
    expect(await credit(id)).toEqual([{ cgst: '0.00', sgst: '0.00', igst: '0.00', reason: 'blocked' }]);
  });

  // F28: a Karnataka hotel, 2,000.00 plus CGST and SGST 120.00 each, by bank; and its variant, a Karnataka cloud supplier's IGST.
  it('posts F28: an out-of-state hotel’s CGST and SGST claim nothing (state); its IGST variant claims 360.00', async () => {
    const hotel = await setup({ state: '29', name: 'Travel' });
    const bank = await systemAccount('bank');
    const stay = await draft(hotel, { lines: [{ taxable: '2000', gstRate: '12', cgst: '120', sgst: '120' }], total: '2240', pay: bank });
    await post(hotel, stay);
    expect(await entryOf(hotel, stay)).toEqual(['Bank 0.00 2240.00', 'Travel 2240.00 0.00'].sort());
    expect(await credit(stay)).toEqual([{ cgst: '0.00', sgst: '0.00', igst: '0.00', reason: 'state' }]);
    const cloud = await setup({ state: '29', name: 'Software' });
    const bill = await draft(cloud, { lines: [{ taxable: '2000', gstRate: '18', igst: '360' }], total: '2360', pay: bank });
    await post(cloud, bill);
    expect(await entryOf(cloud, bill)).toEqual(['Bank 0.00 2360.00', 'Input IGST 360.00 0.00', 'Software 2000.00 0.00'].sort());
    expect(await credit(bill)).toEqual([{ cgst: '0.00', sgst: '0.00', igst: '360.00', reason: null }]);
  });

  it('posts one on credit to its supplier, and cancelling it mirrors the entry, so the supplier is owed nothing', async () => {
    const at = await setup({ state: '27', name: 'Repairs' });
    const id = await draft(at, { lines: [{ taxable: '10000', gstRate: '18', cgst: '900', sgst: '900' }], total: '11800', pay: null });
    await post(at, id);
    expect(await entryOf(at, id)).toEqual(['Creditors 0.00 11800.00', 'Input CGST 900.00 0.00', 'Input SGST 900.00 0.00', 'Repairs 10000.00 0.00'].sort());
    await run((ctx) => cancelExpenseNow(ctx, { id, businessDate: DATE, reason: 'Entered twice' }), at.staff);
    expect(await entryOf(at, id, true)).toEqual(['Creditors 11800.00 0.00', 'Input CGST 0.00 900.00', 'Input SGST 0.00 900.00', 'Repairs 0.00 10000.00'].sort());
    const [owed] = (await su.query<{ v: string }>(`select coalesce(sum(l.credit - l.debit), 0)::numeric(18, 2)::text as v from radcore.journal_lines l
      join radcore.accounts a on a.id = l.account_id where a.system_key = 'creditors' and l.party_id = $1`, [at.supplier])).rows;
    expect(owed?.v).toBe('0.00');
    expect((await run((ctx) => getExpenseById(ctx, { id }), at.staff)).status).toBe('cancelled');
  });

  it('refuses posting with no bill, tax that doesn’t match its rate, a total that doesn’t match, and on credit with no supplier', async () => {
    const at = await setup({ state: '27', name: 'Printing' });
    const bank = await systemAccount('bank');
    expect(await code(post(at, await draft(at, { lines: [{ taxable: '1000', gstRate: '18', cgst: '90', sgst: '90' }], total: '1180', pay: bank,
      file: false })))).toBe('bill_file_required');
    expect(await code(post(at, await draft(at, { lines: [{ taxable: '1000', gstRate: '18', cgst: '60', sgst: '60' }], total: '1120', pay: bank }))))
      .toBe('tax_mismatch');
    expect(await code(post(at, await draft(at, { lines: [{ taxable: '1000', gstRate: '18', cgst: '90', sgst: '90' }], total: '1200', pay: bank }))))
      .toBe('total_mismatch');
    expect(await code(draft(at, { lines: [{ taxable: '1000', gstRate: '0' }], total: '1000', pay: null, supplier: false }))).toBe('needs_supplier');
  });

  it('refuses a GSTIN that isn’t the supplier’s, and an account outside the line’s category, in the service and the database', async () => {
    const at = await setup({ state: '27', name: 'Courier' });
    const other = await account('Courier other');
    const id = await draft(at, { lines: [{ taxable: '500', gstRate: '0' }], total: '500', pay: await systemAccount('bank') });
    const input = { id, businessDate: DATE, supplierId: at.supplier, supplierInvoiceNumber: 'INV/1', supplierInvoiceDate: DATE, supplierGstin: gstin('27'),
      payFromAccountId: await systemAccount('bank'), statedTotal: '500.00' as never, fileId: null, notes: null,
      lines: [{ categoryId: at.categoryId, accountId: at.accountId, description: null, taxable: '500.00' as never, gstRate: '0' as never,
        cgst: '0.00' as never, sgst: '0.00' as never, igst: '0.00' as never }] };
    expect(await code(run((ctx) => changeExpense(ctx, input), at.staff))).toBe('gstin_mismatch');
    const line = { ...input.lines[0], accountId: other };
    expect(await code(run((ctx) => changeExpense(ctx, { ...input, supplierGstin: at.supplierGstin, lines: [line as never] }), at.staff))).toBe('not_in_category');
    expect(await code(owner('update radcore.expense_lines set account_id = $2 where expense_id = $1', [id, other]))).toBe('fk_expense_lines_category_account');
  });

  it('refuses taking an account off a category while an expense line names it (the route answers it as account_in_use)', async () => {
    const at = await setup({ state: '27', name: 'Fuel' });
    const spare = await account('Fuel spare');
    await draft(at, { lines: [{ taxable: '300', gstRate: '0' }], total: '300', pay: await systemAccount('bank') });
    expect(await code(run((ctx) => changeExpenseCategory(ctx, { id: at.categoryId, accountIds: [spare], reason: 'Test' }), at.staff)))
      .toBe('fk_expense_lines_category_account');
  });

  // Section 40A(3) (the architect on #435): a supplier's cash payments and cash expenses are one day's figure. 6,000.00
  // by payment and 5,000.00 by expense pass 10,000.00 together, so whichever is saved second asks for the override.
  for (const first of ['payment', 'expense'] as const) {
    it(`counts cash payments and cash expenses to one supplier as one day’s figure: the ${first} first, the other waits`, async () => {
      const at = await setup({ state: '27', name: 'Loading' });
      const cash = await systemAccount('cash');
      const pay = async () => (await run((ctx) => recordPayment(ctx, recordPaymentContract.input.parse({ kind: 'payment', partyId: at.supplier,
        businessDate: DATE, amount: '6000', accountId: cash })), at.staff)).status;
      const spend = async () => (await post(at, await draft(at, { lines: [{ taxable: '5000', gstRate: '0' }], total: '5000', pay: cash }))).status;
      const [one, two] = first === 'payment' ? [await pay(), await spend()] : [await spend(), await pay()];
      expect([one, two]).toEqual(['posted', 'pending_approval']);
    });
  }

  it('refuses a GSTIN with no supplier (gstin_mismatch)', async () => {
    const at = await setup({ state: '27', name: 'Snacks' });
    const [fileId, cash0] = [await file(), await systemAccount('cash')];
    expect(await code(run((ctx) => addExpense(ctx, createExpense.input.parse({ businessDate: DATE, supplierId: null, supplierInvoiceNumber: 'B1',
      supplierInvoiceDate: DATE, supplierGstin: at.supplierGstin, payFromAccountId: cash0, statedTotal: '100', fileId, notes: null,
      lines: [{ categoryId: at.categoryId, accountId: at.accountId, description: null, taxable: '100', gstRate: '0', cgst: '0', sgst: '0', igst: '0' }] })),
      at.staff))).toBe('gstin_mismatch');
  });

  // ADR-007 §8: cash payments to one party past 10,000.00 in a day need an owner's override, which posts it.
  it('waits for someone else’s override on cash past the day’s limit, then posts', async () => {
    const at = await setup({ state: '27', name: 'Labour' });
    // Made before the request: an approver's account is older than what it decides (RAD-38). It holds payments:approve
    // alone, no expenses key, as an owner may.
    const approver = await person(['payments:approve']);
    const id = await draft(at, { lines: [{ taxable: '12000', gstRate: '0' }], total: '12000', pay: await systemAccount('cash') });
    expect(await post(at, id)).toEqual({ status: 'pending_approval', number: null });
    const [asked] = (await su.query<{ id: string; version_hash: string }>(`select id, version_digest as version_hash from radcore.approvals
      where kind = 'expense-cash' and record_id = $1`, [id])).rows;
    const decide = (as: Principal) => run((ctx) => decideApproval(ctx, expenseCashSpec, asked?.id ?? '', { decision: 'approve',
      versionHash: asked?.version_hash ?? '' }), as);
    expect(await code(decide(at.staff))).toBe('own_request');
    await decide(approver);
    expect((await run((ctx) => getExpenseById(ctx, { id }), at.staff)).status).toBe('posted');
    expect(await entryOf(at, id)).toEqual(['Cash 0.00 12000.00', 'Labour 12000.00 0.00'].sort());
  });
});
