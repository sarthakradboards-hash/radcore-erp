// RAD-148 (M3-33): a party's deliveries still to invoice, read from v_delivery_left, answer exactly what the three
// sums over every delivery, return and invoice answered before (kept here as the reference). The cases: posted,
// draft and cancelled documents; deliveries partly returned, partly invoiced and settled; an invoice of this party's
// billing another party's delivery; and a line with no figures. Made in the database directly (triggers and foreign
// keys off for the seed alone), for parties of the test's own.
import { randomInt, randomUUID } from 'node:crypto';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { notInvoicedLeft } from '../packages/lib-sales/src/services/delivered.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const READ = { readOnly: true, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'user', userId: randomUUID(), permissions: [] };

describe.skipIf(!url || !superUrl)('deliveries still to invoice', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const read = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, READ, AS, randomUUID(), fn);

  // The read before RAD-148: each part summed under its own document's party, keyed by delivery.
  async function reference(partyId: string): Promise<Map<string, string>> {
    const q = async (text: string) => (await su.query<{ id: string; v: string }>(text, [partyId])).rows;
    const out = await q(`select d.id, (coalesce(sum(l.taxable), 0) + coalesce(sum(l.gst), 0))::text v from radcore.delivery_lines l
      join radcore.deliveries d on d.id = l.delivery_id and d.status = 'posted' and d.party_id = $1 group by d.id`);
    const back = await q(`select r.delivery_id id, (coalesce(sum(rl.taxable), 0) + coalesce(sum(rl.gst), 0))::text v from radcore.delivery_return_lines rl
      join radcore.delivery_returns r on r.id = rl.return_id and r.status = 'posted' and r.party_id = $1 group by r.delivery_id`);
    const billed = await q(`select dl.delivery_id id, (coalesce(sum(il.delivery_taxable), 0) + coalesce(sum(il.delivery_gst), 0))::text v
      from radcore.invoice_lines il join radcore.invoices i on i.id = il.invoice_id and i.status = 'posted' and i.party_id = $1
      join radcore.delivery_lines dl on dl.id = il.delivery_line_id group by dl.delivery_id`);
    const left = new Map<string, number>(out.map((r) => [r.id, Math.round(Number(r.v) * 100)]));
    for (const r of [...back, ...billed]) left.set(r.id, (left.get(r.id) ?? 0) - Math.round(Number(r.v) * 100));
    return new Map([...left].filter(([, paise]) => paise !== 0).map(([id, paise]) => [id, (paise / 100).toFixed(2)]));
  }

  it('answers each open delivery’s value left exactly as the sums over every document did', async () => {
    const [party, other] = [randomUUID(), randomUUID()];
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("set local session_replication_role = 'replica'");
      // The parties exist, though no key checks it here: these rows are committed, and a list another file reads names
      // each document's party (the read sweep met "There is no such party" on the sales lists).
      await c.query(`insert into radcore.parties (id, name, state_code, customer) values ($1, 'Delivered left', '27', true),
        ($2, 'Delivered left', '27', true)`, [party, other]);
      const delivery = async (partyId: string, status: string, lines: (readonly [string, string] | null)[]) => {
        const id = randomUUID();
        await c.query(`insert into radcore.deliveries (id, status, number, order_id, party_id, location_id, business_date, owner, cancel_entry_id)
          values ($1::uuid, $2, case when $2 = 'draft' then null else 'T-' || $1::text end, gen_random_uuid(), $3, gen_random_uuid(), '2026-11-01', 'user:x',
            case when $2 = 'cancelled' then gen_random_uuid() end)`, [id, status, partyId]);
        const ids: string[] = [];
        for (const [n, l] of lines.entries()) {
          const lineId = randomUUID();
          ids.push(lineId);
          await c.query(`insert into radcore.delivery_lines (id, delivery_id, line_no, order_line_id, item_id, qty, picks, taxable, gst, value)
            values ($1, $2, $3, gen_random_uuid(), gen_random_uuid(), 1, '{"batches":[],"serials":[]}', $4, $5, $6)`,
          [lineId, id, n + 1, l?.[0] ?? null, l?.[1] ?? null, l === null ? null : '1']);
        }
        return { id, lines: ids };
      };
      const invoice = async (partyId: string, status: string, lines: readonly (readonly [string, string, string])[]) => {
        const id = randomUUID();
        await c.query(`insert into radcore.invoices (id, status, number, party_id, business_date, owner, issuer_gstin, place_of_supply, cancel_entry_id)
          values ($1::uuid, $2, case when $2 = 'draft' then null else 'T-' || $1::text end, $3, '2026-11-02', 'user:x',
            case when $2 = 'draft' then null else '27AAAAA0000A1Z5' end, case when $2 = 'draft' then null else '27' end,
            case when $2 = 'cancelled' then gen_random_uuid() end)`, [id, status, partyId]);
        for (const [n, [deliveryLineId, taxable, gst]] of lines.entries()) {
          await c.query(`insert into radcore.invoice_lines (invoice_id, line_no, delivery_line_id, item_id, qty, rate, hsn, gst_rate, gst_rate_source,
              supply_kind, taxable, cgst, sgst, igst, line_total, cost, delivery_taxable, delivery_gst)
            values ($1, $2, $3, gen_random_uuid(), 1, 1, '87116020', 5, 'Test', 'taxable', 0, 0, 0, 0, 0, 0, $4, $5)`, [id, n + 1, deliveryLineId, taxable, gst]);
        }
      };
      const back = async (partyId: string, status: string, deliveryId: string, lines: readonly (readonly [string, string, string])[]) => {
        const id = randomUUID();
        await c.query(`insert into radcore.delivery_returns (id, status, number, delivery_id, party_id, location_id, business_date, owner, cancel_entry_id)
          values ($1::uuid, $2, case when $2 = 'draft' then null else 'T-' || $1::text end, $3, $4, gen_random_uuid(), '2026-11-03', 'user:x',
            case when $2 = 'cancelled' then gen_random_uuid() end)`, [id, status, deliveryId, partyId]);
        for (const [n, [deliveryLineId, taxable, gst]] of lines.entries()) {
          await c.query(`insert into radcore.delivery_return_lines (return_id, line_no, delivery_line_id, item_id, qty, picks, value, taxable, gst)
            values ($1, $2, $3, gen_random_uuid(), 1, '{"batches":[],"serials":[]}', 1, $4, $5)`, [id, n + 1, deliveryLineId, taxable, gst]);
        }
      };
      const money = () => `${String(randomInt(0, 5000))}.${String(randomInt(0, 100)).padStart(2, '0')}`;
      const settled = await delivery(party, 'posted', [['1000.00', '50.00'], ['200.00', '10.00']]);
      await invoice(party, 'posted', [[settled.lines[0] ?? '', '1000.00', '50.00'], [settled.lines[1] ?? '', '200.00', '10.00']]);
      const part = await delivery(party, 'posted', [['999.99', '49.99'], ['0.01', '0.00']]);
      await invoice(party, 'posted', [[part.lines[0] ?? '', '500.00', '25.00']]);
      await invoice(party, 'cancelled', [[part.lines[0] ?? '', '499.99', '24.99']]);
      await invoice(party, 'draft', [[part.lines[1] ?? '', '0.01', '0.00']]);
      await back(party, 'posted', part.id, [[part.lines[1] ?? '', '0.01', '0.00']]);
      await back(party, 'cancelled', part.id, [[part.lines[0] ?? '', '100.00', '5.00']]);
      // A line with no figures, and a draft and a cancelled delivery, which count for nothing.
      await delivery(party, 'posted', [null, ['10.00', '0.50']]);
      await delivery(party, 'draft', [['300.00', '15.00']]);
      await delivery(party, 'cancelled', [['400.00', '20.00']]);
      // Another party's delivery, billed on this party's invoice: it counts against this party, as the sums did.
      const theirs = await delivery(other, 'posted', [['700.00', '35.00']]);
      await invoice(party, 'posted', [[theirs.lines[0] ?? '', '700.00', '35.00']]);
      for (let i = 0; i < 20; i += 1) {
        const d = await delivery(party, 'posted', [[money(), money()], [money(), money()]]);
        if (randomInt(0, 2) === 0) await invoice(party, 'posted', [[d.lines[0] ?? '', money(), money()]]);
        if (randomInt(0, 3) === 0) await back(party, randomInt(0, 2) === 0 ? 'posted' : 'cancelled', d.id, [[d.lines[1] ?? '', money(), money()]]);
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    for (const p of [party, other]) {
      const now = await read((ctx) => notInvoicedLeft(ctx, p));
      expect(new Map([...now].map(([id, v]) => [id, v.toFixed(2)]))).toEqual(await reference(p));
    }
  });
});
