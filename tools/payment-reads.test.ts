// RAD-116 (for ui-2's RAD-126) on a real PostgreSQL 16, as the app login: receipts, payments and refunds as a list and
// one by one, under payments:read. The list is newest first, a page at a time, filtered by party, kind and status; one
// payment answers what it's applied to (its live allocations) and what's left of it. Each test uses a party of its own.
import { randomUUID } from 'node:crypto';
import { getPaymentById, listPaymentsPage, openFinancialYear, recordPayment } from '@radcore/lib-accounts';
import { moneyString } from '@radcore/lib-common';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const READ = { readOnly: true, isolation: 'read committed' } as const;
const CLERK: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:write'] };
const READER: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:read'] };
const DAY = '2026-11-10';
const m = (s: string) => moneyString().parse(s);

describe.skipIf(!url || !superUrl)('reading receipts, payments and refunds', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const write = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, CLERK, randomUUID(), fn);
  const read = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, READ, READER, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  const bank = async () => (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'")).rows[0]?.id ?? '';
  const party = async () => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<{ id: string }>("insert into radcore.parties (name, customer, supplier, state_code) values ($1, true, true, '27') returning id",
        [`Test party ${randomUUID()}`]);
      await c.query('commit');
      return rows[0]?.id ?? '';
    } finally {
      c.release();
    }
  };

  beforeAll(async () => {
    await write((ctx) => openFinancialYear(ctx, DAY));
  });

  it('lists a party’s receipts, payments and refunds newest first, a page at a time, by kind and status', async () => {
    const [p, account] = [await party(), await bank()];
    const receipt = await write((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: '2026-11-08', amount: m('5000.00'),
      accountId: account, reference: 'UTR123456' }));
    const paid = await write((ctx) => recordPayment(ctx, { kind: 'payment', partyId: p, businessDate: DAY, amount: m('700.00'), accountId: account }));
    const refund = await write((ctx) => recordPayment(ctx, { kind: 'refund', partyId: p, businessDate: DAY, amount: m('300.00'), accountId: account,
      refundOf: receipt.id }));
    const page = (filter: { kind?: 'receipt' | 'payment' | 'refund' }, after?: string) =>
      read((ctx) => listPaymentsPage(ctx, { filter: { partyId: p, ...filter }, limit: 2, ...(after === undefined ? {} : { after }) }));
    // The same day's newest first, by the moment each was recorded.
    const first = await page({});
    expect(first.items.map((i) => i.id)).toEqual([refund.id, paid.id]);
    const second = await page({}, first.next ?? '');
    expect([second.items.map((i) => i.id), second.next]).toEqual([[receipt.id], null]);
    const [r] = (await page({ kind: 'receipt' })).items;
    expect(r).toMatchObject({ kind: 'receipt', status: 'posted', number: expect.stringMatching(/^RV\//) as unknown, amount: '5000.00', tds: '0.00',
      accountId: account, reference: 'UTR123456', refundOf: null, credit: null });
    expect((await page({ kind: 'refund' })).items.map((i) => i.refundOf)).toEqual([receipt.id]);
    expect((await read((ctx) => listPaymentsPage(ctx, { filter: { partyId: p, status: 'draft' }, limit: 10 }))).items).toEqual([]);
  });

  it('answers one payment with its live allocations, its refunds and what’s left of it; another id is not_found', async () => {
    const [p, account] = [await party(), await bank()];
    const receipt = await write((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: DAY, amount: m('5000.00'),
      accountId: account, narration: 'Advance for two scooters' }));
    await write((ctx) => recordPayment(ctx, { kind: 'refund', partyId: p, businessDate: DAY, amount: m('500.00'), accountId: account,
      refundOf: receipt.id }));
    // Two allocations, one of them reversed, made in the database directly against a document of the test's own (the
    // allocation rules are allocations.test.ts's; triggers off for this seed alone).
    const [kept, undone] = [randomUUID(), randomUUID()];
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query("set local session_replication_role = 'replica'");
      await c.query(`insert into radcore.payment_allocations (id, payment_id, document_table, document_id, direction, amount, business_date)
        values ($1, $3, 'invoices', gen_random_uuid(), 'apply', 1200, '2026-11-10'), ($2, $3, 'invoices', gen_random_uuid(), 'apply', 800, '2026-11-10')`,
      [kept, undone, receipt.id]);
      await c.query(`insert into radcore.payment_allocations (payment_id, document_table, document_id, direction, amount, reverses_id, business_date)
        select payment_id, document_table, document_id, 'reverse', amount, id, '2026-11-10' from radcore.payment_allocations where id = $1`, [undone]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const one = await read((ctx) => getPaymentById(ctx, { id: receipt.id }));
    expect([one.narration, one.allocations.map((a) => [a.id, a.amount]), one.allocated, one.refunded, one.left])
      .toEqual(['Advance for two scooters', [[kept, '1200.00']], '1200.00', '500.00', '3300.00']);
    expect(await code(read((ctx) => getPaymentById(ctx, { id: randomUUID() })))).toBe('not_found');
  });
});
