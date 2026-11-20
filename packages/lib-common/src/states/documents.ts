// Posted documents' status moves (ADR-005 §7b, RAD-86). The database holds the same in `state_transitions`, which a
// SQL trigger reads, and a test checks the two are equal. Each posted-document kind adds its moves here and in its
// own migration as it lands (M3 to M6): for a posted document the only move is posted → cancelled, and cancelled is
// final. Keyed by the document's table. A price-list version is held the same way (RAD-98): draft -> approved ->
// superseded.
export const STATE_TRANSITIONS: Readonly<Record<string, readonly (readonly [from: string, to: string])[]>> = {
  payments: [['draft', 'posted'], ['posted', 'cancelled']],
  price_list_versions: [['draft', 'approved'], ['approved', 'superseded']],
};

/** A quote's statuses (ADR-007 §1): it posts nothing, so its service moves it and a CHECK holds the values. */
export const SALES_QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;
export type SalesQuoteStatus = (typeof SALES_QUOTE_STATUSES)[number];
/** An order's statuses (ADR-007 §1): closed when every line is delivered, or closed short with a reason (RC-125). */
export const SALES_ORDER_STATUSES = ['draft', 'confirmed', 'closed', 'cancelled'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];
