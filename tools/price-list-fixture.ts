// A price list for the sales tests (RAD-113): a list whose one version is in force from a fixed past day, with a rate
// for each item given. Approving a version through the service puts it in force from the day it's approved, the real
// date, which a test dated in the past can't use (RC-156); so this writes it as the superuser, a draft moved to
// approved with its day, as #185's guards allow a draft to change. With `partyId`, the party is sold from it.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';

export async function priceListFrom(su: pg.Pool, from: string, rates: Record<string, string>,
  o: { taxInclusive?: boolean; partyId?: string } = {}): Promise<string> {
  const c = await su.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.principal', 'system:test', true)");
    const one = async (text: string, values: unknown[]) => (await c.query<{ id: string }>(text, values)).rows[0]?.id ?? '';
    const list = await one('insert into radcore.price_lists (name) values ($1) returning id', [`Test list ${randomBytes(4).toString('hex')}`]);
    const version = await one('insert into radcore.price_list_versions (price_list_id, tax_inclusive) values ($1, $2) returning id', [list, o.taxInclusive === true]);
    for (const [itemId, rate] of Object.entries(rates)) {
      await c.query('insert into radcore.price_list_rates (version_id, item_id, rate) values ($1, $2, $3)', [version, itemId, rate]);
    }
    await c.query("update radcore.price_list_versions set status = 'approved', in_force_from = $2 where id = $1", [version, from]);
    if (o.partyId !== undefined) await c.query('insert into radcore.party_price_lists (party_id, price_list_id) values ($1, $2)', [o.partyId, list]);
    await c.query('commit');
    return list;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
