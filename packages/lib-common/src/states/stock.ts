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

/** Whose a unit is (ADR-006 §5, RC-027): ours, a customer's (sold, or theirs brought in for service), or gone (back to
 * the supplier, or scrapped). Apart from its condition and any promise, so one column never answers three questions. */
export const UNIT_OWNERSHIPS = ['ours', 'customer', 'gone'] as const;
export type UnitOwnership = (typeof UNIT_OWNERSHIPS)[number];

/** What state a unit is in (ADR-006 §5). */
export const UNIT_CONDITIONS = ['new', 'demo', 'used', 'damaged'] as const;
export type UnitCondition = (typeof UNIT_CONDITIONS)[number];

/**
 * The unit events (ADR-006 §5, RC-026), the only way a unit changes. Each names the stock movements it rides on, which
 * a CHECK on `unit_events` holds: `both` an out and an in (a move), `in` or `out` only, or `neither`. `from` is the
 * ownerships it may start from, `none` meaning the unit has no row yet; the owner migration seeds the same pairs into
 * `unit_event_rules`, and a test checks the two agree, since a trigger can't read this constant. A refused event
 * raises RA008.
 */
export const UNIT_EVENTS = {
  received: { movements: 'in', from: ['none', 'gone'] },
  moved: { movements: 'both', from: ['ours'] },
  reserved: { movements: 'neither', from: ['ours'] },
  released: { movements: 'neither', from: ['ours'] },
  delivered: { movements: 'out', from: ['ours'] },
  delivery_returned: { movements: 'in', from: ['customer'] },
  returned: { movements: 'in', from: ['customer'] },
  returned_to_supplier: { movements: 'out', from: ['ours'] },
  sent_to_job_work: { movements: 'both', from: ['ours'] },
  received_from_job_work: { movements: 'both', from: ['ours'] },
  condition_changed: { movements: 'neither', from: ['ours', 'customer'] },
  chassis_recorded: { movements: 'neither', from: ['ours'] },
  taken_in: { movements: 'neither', from: ['none', 'customer'] },
  handed_back: { movements: 'neither', from: ['customer'] },
  scrapped: { movements: 'out', from: ['ours'] },
} as const satisfies Record<string, { movements: 'both' | 'in' | 'out' | 'neither'; from: readonly (UnitOwnership | 'none')[] }>;

export type UnitEventKind = keyof typeof UNIT_EVENTS;
/** The kinds' codes, in UNIT_EVENTS' order, as a zod enum and a CHECK take them. */
export const UNIT_EVENT_KINDS = Object.keys(UNIT_EVENTS) as [UnitEventKind, ...UnitEventKind[]];
