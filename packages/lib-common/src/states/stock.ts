// Stock's fixed lists (ADR-005 §4): plain constants that the contract's schema and the table's CHECK both import, so
// there's one list. Changing one is a migration plus a change here, in one PR.

/** The kinds of place stock can be (ADR-006 §4, RAD-92). `sellable` decides where a bill's price difference goes. A
 * job worker is one `job_work` location each. */
export const LOCATION_KINDS = {
  store: { sellable: true },
  stores: { sellable: true },
  service_bay: { sellable: true },
  franchisee: { sellable: true },
  rejected: { sellable: false },
  demo: { sellable: false },
  job_work: { sellable: false },
  in_transit: { sellable: false },
} as const;

export type LocationKind = keyof typeof LOCATION_KINDS;
/** The kinds' codes, in LOCATION_KINDS' order, as a zod enum and a CHECK take them. */
export const LOCATION_KIND_CODES = Object.keys(LOCATION_KINDS) as [LocationKind, ...LocationKind[]];
