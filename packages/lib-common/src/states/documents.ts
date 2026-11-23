// Posted documents' status moves (ADR-005 §7b, RAD-86). The database holds the same in `state_transitions`, which a
// SQL trigger reads, and a test checks the two are equal. Each posted-document kind adds its moves here and in its
// own migration as it lands (M3 to M6): for a posted document the only move is posted → cancelled, and cancelled is
// final. Keyed by the document's table. A price-list version is held the same way (RAD-98): draft -> approved ->
// superseded.
export const STATE_TRANSITIONS: Readonly<Record<string, readonly (readonly [from: string, to: string])[]>> = {
  payments: [['draft', 'posted'], ['posted', 'cancelled']],
  price_list_versions: [['draft', 'approved'], ['approved', 'superseded']],
  deliveries: [['draft', 'posted'], ['posted', 'cancelled']],
  delivery_returns: [['draft', 'posted'], ['posted', 'cancelled']],
  invoices: [['draft', 'posted'], ['posted', 'cancelled']],
  credit_notes: [['draft', 'posted'], ['posted', 'cancelled']],
  stock_transfers: [['draft', 'posted'], ['posted', 'cancelled']],
  stock_counts: [['draft', 'posted'], ['posted', 'cancelled']],
  stock_adjustments: [['draft', 'posted'], ['posted', 'cancelled']],
  // A purchase order posts nothing, so no guard reads these; its service moves it (ADR-008 §2).
  purchase_orders: [['draft', 'placed'], ['placed', 'closed'], ['draft', 'cancelled'], ['placed', 'cancelled']],
  purchase_bills: [['draft', 'posted'], ['posted', 'cancelled']],
};

/** A quote's statuses (ADR-007 §1): it posts nothing, so its service moves it and a CHECK holds the values. */
export const SALES_QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;
export type SalesQuoteStatus = (typeof SALES_QUOTE_STATUSES)[number];
/** An order's statuses (ADR-007 §1): closed when every line is delivered, or closed short with a reason (RC-125). */
export const SALES_ORDER_STATUSES = ['draft', 'confirmed', 'closed', 'cancelled'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];
/** A purchase order's statuses (ADR-008 §1): it posts nothing; closed when every line is received, or closed short
 * with a reason, and cancelled only while nothing has been received against it. */
export const PURCHASE_ORDER_STATUSES = ['draft', 'placed', 'closed', 'cancelled'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
/** A purchase bill's statuses (ADR-008 §1, M4-03). */
export const PURCHASE_BILL_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type PurchaseBillStatus = (typeof PURCHASE_BILL_STATUSES)[number];
