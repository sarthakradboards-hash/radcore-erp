// What of each posted delivery is still to invoice (M3-33, RAD-148; M3-07's credit exposure): its lines' selling value
// with GST, less its posted returns' and less what posted invoices took of it, by delivery and by party: each part
// counted under its own document's party, as lib-sales' delivered.ts reads them. A party's read filters on party_id,
// which the planner pushes into each part, and on `left <> 0`, so a long history answers only its open deliveries.
import { sql } from 'drizzle-orm';
import { numeric, uuid } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vDeliveryLeft = radcore.view('v_delivery_left', {
  deliveryId: uuid(),
  partyId: uuid(),
  left: numeric(),
}).as(sql`select delivery_id, party_id, sum(value) as left
  from (select d.id as delivery_id, d.party_id, coalesce(l.taxable, 0) + coalesce(l.gst, 0) as value
    from radcore.deliveries d join radcore.delivery_lines l on l.delivery_id = d.id
    where d.status = 'posted'
    union all
    select r.delivery_id, r.party_id, -(coalesce(rl.taxable, 0) + coalesce(rl.gst, 0))
    from radcore.delivery_returns r join radcore.delivery_return_lines rl on rl.return_id = r.id
    where r.status = 'posted'
    union all
    select dl.delivery_id, i.party_id, -(coalesce(il.delivery_taxable, 0) + coalesce(il.delivery_gst, 0))
    from radcore.invoices i join radcore.invoice_lines il on il.invoice_id = i.id
      join radcore.delivery_lines dl on dl.id = il.delivery_line_id
    where i.status = 'posted') as m
  group by delivery_id, party_id`);
