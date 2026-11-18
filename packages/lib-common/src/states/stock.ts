// Stock's fixed lists (ADR-005 §4): plain constants that the contract's schema and the table's CHECK both import, so
// there's one list. Changing one is a migration plus a change here, in one PR.
import { z } from 'zod';

/** The kinds of place stock can be (ADR-006 §4, RAD-92). `sellable` decides where a bill's price difference goes. A
 * job worker is one `job_work` location each. `label` is the default a screen shows: an admin may rename it, as a
 * setting (lib-stock's location-kinds.ts); the code is what every rule and the database use. */
export const LOCATION_KINDS = {
  store: { sellable: true, label: 'Store (sales floor)' },
  stores: { sellable: true, label: 'Stores (stock room)' },
  service_bay: { sellable: true, label: 'Service bay' },
  franchisee: { sellable: true, label: 'Franchisee' },
  rejected: { sellable: false, label: 'Rejected' },
  demo: { sellable: false, label: 'Demo' },
  job_work: { sellable: false, label: 'Job work' },
  in_transit: { sellable: false, label: 'In transit' },
} as const;

export type LocationKind = keyof typeof LOCATION_KINDS;

/** A location kind's display label, as an admin renames it: trimmed, 1 to 40 characters (RAD-92). */
export const locationKindLabel = () => z.string().trim().min(1, 'Enter a name').max(40);
/** The kinds' codes, in LOCATION_KINDS' order, as a zod enum and a CHECK take them. */
export const LOCATION_KIND_CODES = Object.keys(LOCATION_KINDS) as [LocationKind, ...LocationKind[]];
