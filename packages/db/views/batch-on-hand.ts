// ADR-006 §4a (RAD-93): each item, location and batch's quantity on hand, the `in` batch rows less the `out` ones. A
// null batch is "batch unknown", below zero only after a delivery in negative-stock mode. Read by lib-stock's reports
// and recall query, and by the commit check's test.
import { sql } from 'drizzle-orm';
import { numeric, uuid } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vBatchOnHand = radcore.view('v_batch_on_hand', {
  itemId: uuid(),
  locationId: uuid(),
  batchId: uuid(),
  qty: numeric(),
}).as(sql`select m.item_id, m.location_id, b.batch_id,
    sum(case m.direction when 'in' then b.qty else -b.qty end) as qty
  from radcore.stock_movement_batches b
  join radcore.stock_movements m on m.id = b.movement_id and m.item_id = b.item_id
  group by m.item_id, m.location_id, b.batch_id`);
