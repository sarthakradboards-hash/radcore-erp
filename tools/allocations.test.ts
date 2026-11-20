// RAD-116 part 2 (M3-12; ADR-005 §7a, the architect's ruling) on a real PostgreSQL 16: allocations and credit
// applications in the database. A receipt applies to a receivable charge and a payment to a payable charge, one
// party's, both posted; a credit applies to a charge on its own side. The caps hold at commit (RA006): a document's
// net applied within its total; a payment's allocations and posted refunds within its amount; a credit's
// applications within its total. A reversal undoes exactly one apply. The rows are append-only, a posted payment is
// cancelled only at zero, and v_document_paid sums what was applied. Every case runs in one transaction that rolls
// back, with fixture documents registered inside it, so no test table reaches the registry (RC-155).
import { randomUUID } from 'node:crypto';
import { openFinancialYear, postManualJournal } from '@radcore/lib-accounts';
import type { Money } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
/** What a document's migration does before it registers its table (ADR-005 §7a). */
const guard = (t: string) => `create trigger guard_applied_cancel before update of status on radcore.${t}
  for each row execute function radcore.guard_applied_cancel()`;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const DAY = '2026-11-12';

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the allocation tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('allocations and credit applications', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, AS, randomUUID(), fn);
  // A posted entry for the fixture payments to name: posted_entry_id needs one, and its lines don't matter here.
  const entry = async () => {
    const accounts = (await su.query<{ k: string; id: string }>("select system_key k, id from radcore.accounts where system_key in ('cash', 'round_off')")).rows;
    const id = (k: string) => accounts.find((a) => a.k === k)?.id ?? '';
    return (await run((ctx) => postManualJournal(ctx, { businessDate: DAY, reason: 'Fixture',
      lines: [{ account: { id: id('round_off') }, debit: '1.00' as Money }, { account: { id: id('cash') }, credit: '1.00' as Money }] }))).id;
  };

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });

  /** One rolled-back transaction with three fixture documents registered (a receivable charge, a receivable credit and a
   * payable charge), as the app login; `attempt` runs a statement and fires the deferred checks, answering its SQLSTATE. */
  async function inFixture(fn: (f: {
    party: () => Promise<string>;
    payment: (o: { kind: 'receipt' | 'payment' | 'refund'; party: string; amount: string; refundOf?: string; status?: 'draft' | 'posted' }) => Promise<string>;
    doc: (table: 't_invoices' | 't_credits' | 't_bills', o: { party: string; total: string; status?: string; date?: string }) => Promise<string>;
    attempt: (text: string, values?: unknown[]) => Promise<string>;
    named: (text: string, values?: unknown[]) => Promise<string>;
    query: <T extends pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
  }) => Promise<void>) {
    const postedEntry = await entry();
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      for (const t of ['t_invoices', 't_credits', 't_bills']) {
        await c.query(`create table radcore.${t} (id uuid primary key default gen_random_uuid(), party_id uuid not null, status text not null,
          total numeric(18,2) not null, business_date date not null)`);
      }
      // The app writes them; the checks, which run as the owner (SECURITY DEFINER), lock and read them, as a migration's own tables.
      await c.query('grant select, insert, update on radcore.t_invoices, radcore.t_credits, radcore.t_bills to radcore_app, radcore_owner');
      for (const t of ['t_invoices', 't_credits', 't_bills']) await c.query(guard(t));
      await c.query(`insert into radcore.allocatable_documents (document_table, side, kind) values
        ('t_invoices', 'receivable', 'charge'), ('t_credits', 'receivable', 'credit'), ('t_bills', 'payable', 'charge')`);
      await c.query('set local role radcore_app');
      const query = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => (await c.query<T>(text, values)).rows;
      const bank = (await query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'"))[0]?.id ?? '';
      const settle = async (text: string, values: unknown[], named: boolean) => {
        await c.query('savepoint attempt');
        try {
          await c.query(text, values);
          await c.query('set constraints all immediate');
          await c.query('set constraints all deferred');
          await c.query('release savepoint attempt');
          return 'ok';
        } catch (e) {
          await c.query('rollback to savepoint attempt');
          const { code = 'error', constraint } = e as { code?: string; constraint?: string };
          return named && constraint ? `${code}:${constraint}` : code;
        }
      };
      await fn({
        party: async () => (await query<{ id: string }>("insert into radcore.parties (name, customer, supplier, state_code) values ($1, true, true, '27') returning id",
          [`Fixture party ${randomUUID()}`]))[0]?.id ?? '',
        payment: async (o) => {
          const [row] = await query<{ id: string }>(`insert into radcore.payments (kind, party_id, business_date, amount, account_id, refund_of_id)
            values ($1, $2, $3, $4, $5, $6) returning id`, [o.kind, o.party, DAY, o.amount, bank, o.refundOf ?? null]);
          if ((o.status ?? 'posted') === 'posted') {
            await query("update radcore.payments set status = 'posted', number = $2, posted_entry_id = $3 where id = $1",
              [row?.id, `RV/${randomUUID().slice(0, 8)}`, postedEntry]);
          }
          return row?.id ?? '';
        },
        doc: async (table, o) => (await query<{ id: string }>(`insert into radcore.${table} (party_id, status, total, business_date)
          values ($1, $2, $3, $4) returning id`, [o.party, o.status ?? 'posted', o.total, o.date ?? DAY]))[0]?.id ?? '',
        attempt: (text, values = []) => settle(text, values, false),
        named: (text, values = []) => settle(text, values, true),
        query,
      });
    } finally {
      await c.query('rollback');
      c.release();
    }
  }
  const apply = `insert into radcore.payment_allocations (payment_id, document_table, document_id, direction, amount, business_date)
    values ($1, $2, $3, $4, $5, '${DAY}') returning id`;

  it('applies a receipt to its party’s posted invoice, and never past the invoice’s total, whoever pays', async () => {
    await inFixture(async (f) => {
      const p = await f.party();
      const inv = await f.doc('t_invoices', { party: p, total: '100.00' });
      const [r1, r2] = [await f.payment({ kind: 'receipt', party: p, amount: '60.00' }), await f.payment({ kind: 'receipt', party: p, amount: '60.00' })];
      expect(await f.attempt(apply, [r1, 't_invoices', inv, 'apply', '60.00'])).toBe('ok');
      expect(await f.attempt(apply, [r2, 't_invoices', inv, 'apply', '40.01'])).toBe('RA006');
      expect(await f.attempt(apply, [r2, 't_invoices', inv, 'apply', '40.00'])).toBe('ok');
      expect(await f.query('select allocated::text, credited::text, paid::text from radcore.v_document_paid where document_id = $1', [inv]))
        .toEqual([{ allocated: '100.00', credited: '0', paid: '100.00' }]);
    });
  });

  it('never applies a payment past its amount, its posted refunds counted (gross of TDS, F8)', async () => {
    await inFixture(async (f) => {
      const p = await f.party();
      const [a, b] = [await f.doc('t_invoices', { party: p, total: '100.00' }), await f.doc('t_invoices', { party: p, total: '100.00' })];
      const r = await f.payment({ kind: 'receipt', party: p, amount: '100.00' });
      expect(await f.attempt(apply, [r, 't_invoices', a, 'apply', '70.00'])).toBe('ok');
      expect(await f.attempt(apply, [r, 't_invoices', b, 'apply', '30.01'])).toBe('RA006');
      await f.payment({ kind: 'refund', party: p, amount: '20.00', refundOf: r });
      expect(await f.attempt(apply, [r, 't_invoices', b, 'apply', '10.01'])).toBe('RA006');
      expect(await f.attempt(apply, [r, 't_invoices', b, 'apply', '10.00'])).toBe('ok');
    });
  });

  it('refuses the wrong pair, another party, an unposted side, a refund, or a table not in the registry', async () => {
    await inFixture(async (f) => {
      const [p, q] = [await f.party(), await f.party()];
      const inv = await f.doc('t_invoices', { party: p, total: '100.00' });
      const r = await f.payment({ kind: 'receipt', party: p, amount: '100.00' });
      expect(await f.attempt(apply, [r, 't_bills', await f.doc('t_bills', { party: p, total: '100.00' }), 'apply', '1.00'])).toBe('RA006');
      expect(await f.attempt(apply, [await f.payment({ kind: 'payment', party: p, amount: '10.00' }), 't_invoices', inv, 'apply', '1.00'])).toBe('RA006');
      expect(await f.attempt(apply, [await f.payment({ kind: 'receipt', party: q, amount: '10.00' }), 't_invoices', inv, 'apply', '1.00'])).toBe('RA006');
      expect(await f.attempt(apply, [r, 't_invoices', await f.doc('t_invoices', { party: p, total: '9.00', status: 'draft' }), 'apply', '1.00'])).toBe('RA006');
      expect(await f.attempt(apply, [await f.payment({ kind: 'receipt', party: p, amount: '10.00', status: 'draft' }), 't_invoices', inv, 'apply', '1.00']))
        .toBe('RA006');
      expect(await f.attempt(apply, [await f.payment({ kind: 'refund', party: p, amount: '5.00', refundOf: r }), 't_invoices', inv, 'apply', '1.00']))
        .toBe('RA006');
      expect(await f.attempt(apply, [r, 'invoices', randomUUID(), 'apply', '1.00'])).toBe('23503');
      expect(await f.attempt(apply, [r, 't_credits', await f.doc('t_credits', { party: p, total: '5.00' }), 'apply', '1.00'])).toBe('RA006');
    });
  });

  it('reverses exactly one apply, of its own document, payment and amount, once; the rows never change', async () => {
    await inFixture(async (f) => {
      const p = await f.party();
      const [inv, other] = [await f.doc('t_invoices', { party: p, total: '100.00' }), await f.doc('t_invoices', { party: p, total: '100.00' })];
      const r = await f.payment({ kind: 'receipt', party: p, amount: '100.00' });
      const [row] = await f.query<{ id: string }>(apply, [r, 't_invoices', inv, 'apply', '60.00']);
      const reverse = `insert into radcore.payment_allocations (payment_id, document_table, document_id, direction, amount, reverses_id, business_date) values ($1, $2, $3, $4, $5, $6, '2026-11-12')`;
      expect(await f.attempt(reverse, [r, 't_invoices', inv, 'reverse', '10.00', row?.id])).toBe('23503');
      expect(await f.attempt(reverse, [r, 't_invoices', other, 'reverse', '60.00', row?.id])).toBe('23503');
      expect(await f.attempt(reverse, [r, 't_invoices', inv, 'reverse', '60.00', row?.id])).toBe('ok');
      expect(await f.attempt(reverse, [r, 't_invoices', inv, 'reverse', '60.00', row?.id])).toBe('23505');
      expect(await f.query('select paid::text from radcore.v_document_paid where document_id = $1', [inv])).toEqual([{ paid: '0.00' }]);
      expect(await f.attempt('update radcore.payment_allocations set amount = 1 where id = $1', [row?.id])).toBe('42501');
      expect(await f.attempt('delete from radcore.payment_allocations where id = $1', [row?.id])).toBe('42501');
    });
  });

  it('applies a credit to a charge on its side, of its party, within both totals, and counts it as paid', async () => {
    await inFixture(async (f) => {
      const p = await f.party();
      const inv = await f.doc('t_invoices', { party: p, total: '100.00' });
      const cn = await f.doc('t_credits', { party: p, total: '30.00' });
      const credit = `insert into radcore.credit_applications (credit_table, credit_id, document_table, document_id, direction, amount, business_date)
        values ($1, $2, $3, $4, $5, $6, '2026-11-12')`;
      expect(await f.attempt(credit, ['t_credits', cn, 't_invoices', inv, 'apply', '30.01'])).toBe('RA006');
      expect(await f.attempt(credit, ['t_credits', cn, 't_invoices', inv, 'apply', '30.00'])).toBe('ok');
      expect(await f.attempt(credit, ['t_credits', cn, 't_bills', await f.doc('t_bills', { party: p, total: '9.00' }), 'apply', '1.00'])).toBe('RA006');
      expect(await f.attempt(credit, ['t_invoices', inv, 't_invoices', await f.doc('t_invoices', { party: p, total: '9.00' }), 'apply', '1.00'])).toBe('RA006');
      const r = await f.payment({ kind: 'receipt', party: p, amount: '100.00' });
      expect(await f.attempt(apply, [r, 't_invoices', inv, 'apply', '70.01'])).toBe('RA006');
      expect(await f.attempt(apply, [r, 't_invoices', inv, 'apply', '70.00'])).toBe('ok');
      expect(await f.query('select allocated::text, credited::text, paid::text from radcore.v_document_paid where document_id = $1', [inv]))
        .toEqual([{ allocated: '70.00', credited: '30.00', paid: '100.00' }]);
    });
  });

  it('cancels a posted payment only once its allocations are reversed to zero', async () => {
    await inFixture(async (f) => {
      const p = await f.party();
      const inv = await f.doc('t_invoices', { party: p, total: '100.00' });
      const r = await f.payment({ kind: 'receipt', party: p, amount: '100.00' });
      const [row] = await f.query<{ id: string }>(apply, [r, 't_invoices', inv, 'apply', '40.00']);
      // Each save's deferred checks settle at its own commit: here, before the cancel.
      expect(await f.attempt('select 1')).toBe('ok');
      const cancel = `update radcore.payments set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system:test', cancel_reason = 'x',
        cancel_entry_id = posted_entry_id where id = $1`;
      expect(await f.attempt(cancel, [r])).toBe('RA006');
      await f.query(`insert into radcore.payment_allocations (payment_id, document_table, document_id, direction, amount, reverses_id, business_date) values ($1, $2, $3, $4, $5, $6, '2026-11-12')`,
        [r, 't_invoices', inv, 'reverse', '40.00', row?.id]);
      expect(await f.attempt('select 1')).toBe('ok');
      expect(await f.attempt(cancel, [r])).toBe('ok');
    });
  });

  it('dates a row on or after its document, and a credit’s on or after both, by name; a ledger row in a year nobody opened is refused', async () => {
    await inFixture(async (f) => {
      const p = await f.party();
      const later = await f.doc('t_invoices', { party: p, total: '100.00', date: '2026-11-13' });
      const r = await f.payment({ kind: 'receipt', party: p, amount: '100.00' });
      expect(await f.named(apply, [r, 't_invoices', later, 'apply', '1.00'])).toBe('RA006:allocation_before_source');
      const credit = `insert into radcore.credit_applications (credit_table, credit_id, document_table, document_id, direction, amount, business_date)
        values ('t_credits', $1, 't_invoices', $2, 'apply', '1.00', $3)`;
      const inv = await f.doc('t_invoices', { party: p, total: '100.00' });
      const cn = await f.doc('t_credits', { party: p, total: '9.00', date: '2026-11-13' });
      expect(await f.named(credit, [cn, inv, DAY])).toBe('RA006:credit_application_before_source');
      expect(await f.named(credit, [cn, inv, '2026-11-13'])).toBe('ok');
      expect(await f.named(`insert into radcore.payment_allocations (payment_id, document_table, document_id, direction, amount, business_date)
        values ($1, 't_invoices', $2, 'apply', '1.00', '2031-04-01')`, [r, inv])).toBe('23503:fk_payment_allocations_fy_start');
    });
  });

  it('cancels a registered document only once nothing is applied to it, and a credit only once it applies to nothing', async () => {
    await inFixture(async (f) => {
      const p = await f.party();
      const inv = await f.doc('t_invoices', { party: p, total: '100.00' });
      const cn = await f.doc('t_credits', { party: p, total: '30.00' });
      const r = await f.payment({ kind: 'receipt', party: p, amount: '100.00' });
      const [row] = await f.query<{ id: string }>(apply, [r, 't_invoices', inv, 'apply', '40.00']);
      const [cr] = await f.query<{ id: string }>(`insert into radcore.credit_applications (credit_table, credit_id, document_table, document_id, direction,
        amount, business_date) values ('t_credits', $1, 't_invoices', $2, 'apply', '30.00', '2026-11-12') returning id`, [cn, inv]);
      expect(await f.attempt('select 1')).toBe('ok');
      const cancel = (t: string) => `update radcore.${t} set status = 'cancelled' where id = $1`;
      expect(await f.named(cancel('t_invoices'), [inv])).toBe('RA006:document_still_applied');
      expect(await f.named(cancel('t_credits'), [cn])).toBe('RA006:document_still_applied');
      await f.query(`insert into radcore.payment_allocations (payment_id, document_table, document_id, direction, amount, reverses_id,
        business_date) values ($1, 't_invoices', $2, 'reverse', '40.00', $3, '2026-11-12')`, [r, inv, row?.id]);
      expect(await f.named(cancel('t_invoices'), [inv])).toBe('RA006:document_still_applied');
      await f.query(`insert into radcore.credit_applications (credit_table, credit_id, document_table, document_id, direction, amount, reverses_id,
        business_date) values ('t_credits', $1, 't_invoices', $2, 'reverse', '30.00', $3, '2026-11-12')`, [cn, inv, cr?.id]);
      expect(await f.attempt('select 1')).toBe('ok');
      expect(await f.named(cancel('t_credits'), [cn])).toBe('ok');
      expect(await f.named(cancel('t_invoices'), [inv])).toBe('ok');
    });
  });

  it('registers only a table with an id, a party, a status, a total and a date, of their types, and its cancel guard attached', async () => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const shapes = {
        t_shapeless: 'party_id uuid, status text, business_date date',
        t_text_total: 'party_id uuid, status text, total text, business_date date',
        t_undated: 'party_id uuid, status text, total numeric(18,2)',
        t_unguarded: 'party_id uuid, status text, total numeric(18,2), business_date date',
        t_after: 'party_id uuid, status text, total numeric(18,2), business_date date',
        t_ready: 'party_id uuid, status text, total numeric(18,2), business_date date',
      };
      for (const [t, cols] of Object.entries(shapes)) {
        await c.query(`create table radcore.${t} (id uuid primary key, ${cols})`);
        if (t === 't_after') await c.query(guard(t).replace('before update', 'after update'));
        else if (t !== 't_unguarded') await c.query(guard(t));
      }
      const register = async (t: string) => {
        await c.query('savepoint s');
        return c.query("insert into radcore.allocatable_documents (document_table, side, kind) values ($1, 'receivable', 'charge')", [t])
          .then(() => 'ok', async (e: { code?: string; constraint?: string }) => {
            await c.query('rollback to savepoint s');
            return `${e.code}:${e.constraint}`;
          });
      };
      for (const t of ['t_shapeless', 't_text_total', 't_undated', 't_unguarded', 't_after', 't_nowhere']) expect(await register(t)).toBe('RA006:allocatable_document_shape');
      expect(await register('t_ready')).toBe('ok');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
