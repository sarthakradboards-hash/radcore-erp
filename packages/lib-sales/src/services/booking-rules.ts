// What a booking may hold (RAD-117; the architect's ruling): a unit a delivery would take. Pure, so it's tested apart.

/** A unit as lib-stock's unitFor answers it. */
export type UnitState = Readonly<{ ownership: string; condition: string; locationId: string | null }>;

/** Ours, at a place (never with a customer), and new or used, or damaged where stock.sell_damaged_units says a delivery
 * may take one. Demo stock sits at a place that isn't sellable, which the booking checks apart. */
export const bookable = (u: UnitState, sellDamaged: boolean): boolean =>
  u.ownership === 'ours' && u.locationId !== null && (u.condition === 'new' || u.condition === 'used' || (sellDamaged && u.condition === 'damaged'));
