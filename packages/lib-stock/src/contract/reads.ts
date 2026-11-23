// Stock's reads for the stock screens (RAD-144), re-exported by ../contract.ts: what's on hand, item by place, and the
// serialised units with each one's trail. Under stock:read, as getOnHand is; a position's value is a stock value,
// `cost()`, masked without cost:read. Like every contract file it imports only zod, lib-common and other libraries'
// contract entries (D5).
import {
  cost, dateString, defineContract, idString, listInput, listOf, LOCATION_KIND_CODES, momentString, moneyString, quantityString, searchText,
  UNIT_CONDITIONS, UNIT_EVENT_KINDS, UNIT_OWNERSHIPS,
} from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const item = { itemId: idString(), sku: z.string(), name: z.string() };

/**
 * GET /stock/positions (stock:read): what's on hand, a row per item and place holding any, by SKU then place code.
 * `search` matches the item's SKU or name. A position's value is kept by item and place, not by batch (ADR-006 §4a), so
 * each row carries its value once and its batches' quantities, "batch unknown" as a `batchId` of null.
 */
export const listStockOnHand = defineContract({
  method: 'GET', path: '/stock/positions', auth: 'session', perm: 'stock:read', tx: read,
  input: listInput(z.object({ itemId: idString().optional(), locationId: idString().optional(), search: searchText().optional() })),
  output: listOf(z.object({
    ...item, unit: z.string(), locationId: idString(), locationName: z.string(), locationKind: z.enum(LOCATION_KIND_CODES),
    qty: quantityString({ signed: true }), value: cost(moneyString({ signed: true })),
    batches: z.array(z.object({ batchId: idString().nullable(), batchNo: z.string().nullable(), qty: quantityString({ signed: true }) })),
  })),
});

const unitRow = z.object({
  id: idString(), serialNo: z.string(), chassisNo: z.string().nullable(), ...item,
  // Ours is at a place and a gone one at none; a customer's is at one only while it's in for service (`taken_in`).
  ownership: z.enum(UNIT_OWNERSHIPS), locationId: idString().nullable(), locationName: z.string().nullable(),
  condition: z.enum(UNIT_CONDITIONS), batchNo: z.string().nullable(),
  // Promised to an order line by a booking (M3-13).
  promised: z.boolean(),
});

/** GET /stock/units (stock:read): the serialised units, by serial; `search` a prefix of a serial or a chassis number. */
export const listStockUnits = defineContract({
  method: 'GET', path: '/stock/units', auth: 'session', perm: 'stock:read', tx: read,
  input: listInput(z.object({ itemId: idString().optional(), locationId: idString().optional(), ownership: z.enum(UNIT_OWNERSHIPS).optional(),
    search: z.string().trim().min(1).max(60).optional() })),
  output: listOf(unitRow),
});

/** GET /stock/units/:id (stock:read): a unit, and its trail, oldest first: each event, where it left the unit, and its document. */
export const getStockUnit = defineContract({
  method: 'GET', path: '/stock/units/:id', auth: 'session', perm: 'stock:read', tx: read,
  input: z.object({ id: idString() }),
  output: unitRow.extend({ events: z.array(z.object({
    id: idString(), kind: z.enum(UNIT_EVENT_KINDS), businessDate: dateString(), postedAt: momentString(),
    locationId: idString().nullable(), locationName: z.string().nullable(), condition: z.enum(UNIT_CONDITIONS).nullable(),
    source: z.object({ table: z.string(), id: idString() }),
  })) }),
});
