// RAD-111 (the architect's ruling) on a real PostgreSQL 16, as the app login: what a party owes, from its Debtors
// lines as at a date. Bills and payments of the party's own count, another party's don't, and nothing dated after the
// date does. The party is the test's own; entries are dated in 2034-35, which no other file posts in.
import { randomInt, randomUUID } from 'node:crypto';
import { openFinancialYear, partyReceivable, postEntry, reverseEntry } from '@radcore/lib-accounts';
import type { Money } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { receivable } from '../packages/lib-accounts/src/rules/receivable.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const READ = { readOnly: true, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const m = (s: string) => s as Money;

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the receivable tests must run, not skip');
});

describe.skipIf(!url)('what a party owes', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>, spec: typeof WRITE | typeof READ = WRITE) => runInTransaction(db, spec, AS, randomUUID(), fn);
  // The party's bill (Dr Debtors) or payment (Cr Debtors), against Opening Balance Equity: `opening` posts to any control account.
  const post = (party: string, date: string, side: 'bill' | 'paid', amount: string) =>
    run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: date, source: { table: 'files', id: randomUUID() }, lines: side === 'bill'
      ? [{ account: { system: 'debtors' }, partyId: party, debit: m(amount) }, { account: { system: 'opening_equity' }, credit: m(amount) }]
      : [{ account: { system: 'opening_equity' }, debit: m(amount) }, { account: { system: 'debtors' }, partyId: party, credit: m(amount) }] }));
  const owes = (party: string, on: string) => run((ctx) => partyReceivable(ctx, party, on), READ);

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, '2034-04-01'));
  });

  it('nets the party’s own bills and payments, and finds the oldest bill they haven’t paid', async () => {
    const [party, other] = [randomUUID(), randomUUID()];
    await post(party, '2034-04-10', 'bill', '100.00');
    await post(party, '2034-05-01', 'bill', '50.00');
    await post(party, '2034-05-20', 'paid', '60.00');
    await post(other, '2034-04-01', 'bill', '999.00');
    expect(await owes(party, '2034-06-01')).toEqual({ outstanding: '90.00', oldestUnpaid: '2034-04-10' });
    await post(party, '2034-05-25', 'paid', '40.00');
    expect(await owes(party, '2034-06-01')).toEqual({ outstanding: '50.00', oldestUnpaid: '2034-05-01' });
  });

  it('counts nothing dated after the date, and owes nothing with no lines', async () => {
    const party = randomUUID();
    await post(party, '2034-04-10', 'bill', '100.00');
    await post(party, '2034-07-01', 'paid', '100.00');
    expect(await owes(party, '2034-06-30')).toEqual({ outstanding: '100.00', oldestUnpaid: '2034-04-10' });
    expect(await owes(party, '2034-07-01')).toEqual({ outstanding: '0.00', oldestUnpaid: null });
    expect(await owes(randomUUID(), '2034-07-01')).toEqual({ outstanding: '0.00', oldestUnpaid: null });
  });

  it('never pays an older bill with a cancelled bill’s reversal, and counts the bill until its reversal’s date (the auditor on #229)', async () => {
    const party = randomUUID();
    await post(party, '2034-04-01', 'bill', '100.00');
    const b = await post(party, '2034-05-01', 'bill', '50.00');
    await run((ctx) => reverseEntry(ctx, { entryId: b.id, businessDate: '2034-05-10', reason: 'Billed in error' }));
    expect(await owes(party, '2034-06-01')).toEqual({ outstanding: '100.00', oldestUnpaid: '2034-04-01' });
    // A bill cancelled after the date still counts as at the date.
    const later = randomUUID();
    await post(later, '2034-04-01', 'bill', '100.00');
    await post(later, '2034-04-10', 'paid', '100.00');
    const c = await post(later, '2034-05-01', 'bill', '50.00');
    await run((ctx) => reverseEntry(ctx, { entryId: c.id, businessDate: '2034-06-15', reason: 'Billed in error' }));
    expect(await owes(later, '2034-06-01')).toEqual({ outstanding: '50.00', oldestUnpaid: '2034-05-01' });
    expect(await owes(later, '2034-06-30')).toEqual({ outstanding: '0.00', oldestUnpaid: null });
  });

  it('shows an advance as the party in credit', async () => {
    const party = randomUUID();
    await post(party, '2034-04-05', 'paid', '500.00');
    expect(await owes(party, '2034-06-01')).toEqual({ outstanding: '-500.00', oldestUnpaid: null });
  });

  // RAD-148: worked out in the database, the answer is the rule's over every line, for any history and any date:
  // bills, payments and advances of any size, either reversed on a later day, and dates before, between and after them.
  it('answers exactly what the rule over every line answers, for random histories and dates', async () => {
    const day = (n: number) => new Date(Date.UTC(2034, 3, 1 + n)).toISOString().slice(0, 10);
    for (let round = 0; round < 6; round += 1) {
      const party = randomUUID();
      const posted: { id: string; date: number }[] = [];
      for (let i = 0; i < 25; i += 1) {
        const date = randomInt(0, 300);
        const amount = `${String(randomInt(1, 500))}.${String(randomInt(0, 100)).padStart(2, '0')}`;
        posted.push({ id: (await post(party, day(date), randomInt(0, 3) === 0 ? 'paid' : 'bill', amount)).id, date });
      }
      for (const p of posted.filter(() => randomInt(0, 5) === 0)) {
        await run((ctx) => reverseEntry(ctx, { entryId: p.id, businessDate: day(p.date + randomInt(0, 40)), reason: 'Test' }));
      }
      const { rows } = await pool.query<{ businessDate: string; debit: string; credit: string; entryId: string; reversesEntryId: string | null }>(
        `select l.business_date::text as "businessDate", l.debit::text as debit, l.credit::text as credit, l.entry_id as "entryId",
          e.reverses_entry_id as "reversesEntryId", l.posted_at, l.id
        from radcore.journal_lines l join radcore.accounts a on a.id = l.account_id join radcore.journal_entries e on e.id = l.entry_id
        where a.system_key = 'debtors' and l.party_id = $1 order by l.business_date, l.posted_at, l.id`, [party]);
      for (const on of [day(-1), ...Array.from({ length: 8 }, () => day(randomInt(0, 345)))]) {
        expect(await owes(party, on), `as at ${on}`).toEqual(receivable(rows.filter((r) => r.businessDate <= on)));
      }
    }
  }, 120_000);
});
