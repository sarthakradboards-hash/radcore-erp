// A posted delivery for the sales tests that need one committed (RAD-118, RAD-120): a customer in Maharashtra with
// credit and an address, an item at 5% GST (or `gst`), a confirmed order for one at 80,000.00, and its posted delivery. With
// `condition`, the item is serialised and the unit delivered is in it.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString, type UnitCondition } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import type { Ctx } from '@radcore/lib-platform';
import { addDelivery, addOrder, confirmOrderNow, getDeliveryById, getOrderById, postDeliveryNow } from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import type pg from 'pg';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);

/** `run` commits its work as the staff member the test acts as; `su` is the superuser's pool; `DATE` the business day. */
export async function postedDelivery(run: <T>(fn: (ctx: Ctx) => Promise<T>) => Promise<T>, su: pg.Pool, DATE: string,
  condition?: UnitCondition, o: { gst?: string } = {}) {
  const serial = condition === undefined ? undefined : `SN-${tag()}`;
  const made = await run(async (ctx) => {
    await openFinancialYear(ctx, DATE);
    const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
      stateCode: '27', phone: null, email: null, addressLine1: '12 MG Road', addressLine2: null, city: 'Pune', pincode: '411001' });
    await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: moneyString().parse('100000000'), reason: 'Test' });
    const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
    const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
    await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse(o.gst ?? '5'), source: 'Notification 1/2017-CT(R)', note: null,
      reason: 'Test' });
    const { id: itemId } = await addItem(ctx, { sku: `I-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
      serialised: serial !== undefined, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
    const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
    await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
      qty: q(serial === undefined ? '2' : '1'), rate: unitPriceString().parse('61250'), batches: [{ batchNo: 'B1', qty: q(serial === undefined ? '2' : '1') }],
      ...(serial === undefined ? {} : { units: [{ serialNo: serial, condition: condition ?? 'new' }] }) }] });
    return { partyId, itemId, placeId };
  });
  await priceListFrom(su, DATE, { [made.itemId]: '80000' }, { partyId: made.partyId });
  const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
  return run(async (ctx) => {
    const { id: orderId } = await addOrder(ctx, { partyId: made.partyId, businessDate: DATE, notes: null, lines: [{ itemId: made.itemId,
      qty: q('1'), rate: unitPriceString().parse('80000'), discountPercent: percentString({ max: '100' }).parse('0') }] });
    await confirmOrderNow(ctx, { id: orderId });
    const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
    const { id } = await addDelivery(ctx, { orderId, locationId: made.placeId, businessDate: DATE, notes: null,
      lines: [{ orderLineId, qty: q('1'), batches: [{ batchId: batch?.id ?? '', qty: q('1') }], serials: serial === undefined ? [] : [serial] }] });
    await postDeliveryNow(ctx, { id });
    return { partyId: made.partyId, itemId: made.itemId, deliveryId: id, deliveryLineId: (await getDeliveryById(ctx, { id })).lines[0]?.id ?? '' };
  });
}
