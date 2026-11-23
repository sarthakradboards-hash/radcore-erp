CREATE VIEW "radcore"."v_delivery_left" AS (select delivery_id, party_id, sum(value) as left
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
  group by delivery_id, party_id);--> statement-breakpoint
-- A view over the documents, read only (ADR-005 §7a), as v_document_paid is.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.v_delivery_left FROM radcore_app;
