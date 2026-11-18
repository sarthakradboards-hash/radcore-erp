// lib-sales's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every contract
// file it imports only zod, lib-common and other libraries' contract entries (D5), so the browser can load it.
import {
  defineContract, idString, listInput, listOf, momentString, percentString, reason, searchText, unitPriceString,
} from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

// Price lists (M2-13, RAD-98). A list's prices are a version: the admin edits a draft, someone else approves it
// (maker-checker, RAD-38), and only then does it price anything. The version before stays as history.
const listName = () => z.string().trim().min(1, 'Name the price list').max(80);
const status = z.enum(['active', 'inactive']);
const versionState = z.enum(['draft', 'in_force', 'superseded']);

/** Price lists a page at a time, by name: each with the version in force (if one was ever approved) and its draft. */
export const listPriceLists = defineContract({
  method: 'GET', path: '/price-lists', auth: 'session', perm: 'prices:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), status: status.optional() })),
  output: listOf(z.object({
    id: idString(), name: z.string(), active: z.boolean(),
    inForce: z.object({ versionId: idString(), taxInclusive: z.boolean(), approvedAt: momentString() }).nullable(),
    draftId: idString().nullable(),
  })),
});

/** A new list, with an empty draft to fill. name_taken: another list has this name, whatever its case or spacing. */
export const createPriceList = defineContract({
  method: 'POST', path: '/price-lists', auth: 'session', perm: 'prices:write', tx: write,
  input: z.object({ name: listName(), taxInclusive: z.boolean() }),
  output: z.object({ id: idString(), draftId: idString() }), errors: ['name_taken'],
});

/** A list renamed, or switched off or on. Neither changes a price, so neither needs approval. */
export const updatePriceList = defineContract({
  method: 'PATCH', path: '/price-lists/:id', auth: 'session', perm: 'prices:write', tx: write,
  input: z.object({ id: idString(), name: listName().optional(), active: z.boolean().optional() }),
  output: z.object({}), errors: ['name_taken'],
});

/** The list's draft: the one it has, or a new one copied from the version in force. */
export const startPriceListDraft = defineContract({
  method: 'POST', path: '/price-lists/:id/draft', auth: 'session', perm: 'prices:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ draftId: idString() }),
});

/** One version: whether its rates include GST, and whether it's a draft, in force or superseded. */
export const getPriceListVersion = defineContract({
  method: 'GET', path: '/price-lists/versions/:id', auth: 'session', perm: 'prices:read', tx: read,
  input: z.object({ id: idString() }),
  output: z.object({
    id: idString(), priceListId: idString(), taxInclusive: z.boolean(), state: versionState,
    approvedAt: momentString().nullable(), supersededAt: momentString().nullable(),
  }),
});

/** A version's rates a page at a time, by item id. */
export const listPriceListRates = defineContract({
  method: 'GET', path: '/price-lists/versions/:id/rates', auth: 'session', perm: 'prices:read', tx: read,
  input: listInput(z.object({})).extend({ id: idString() }),
  output: listOf(z.object({ itemId: idString(), rate: unitPriceString() })),
});

/** A draft's rates made tax-inclusive or exclusive. not_a_draft: the version was approved, so it can't change. */
export const setPriceListTax = defineContract({
  method: 'PATCH', path: '/price-lists/versions/:id', auth: 'session', perm: 'prices:write', tx: write,
  input: z.object({ id: idString(), taxInclusive: z.boolean() }), output: z.object({}), errors: ['not_a_draft'],
});

/** Rates set in a draft, up to 500 at once; a null rate takes the item out. not_a_draft: the version was approved;
 * unknown_item: an item id names no item. */
export const putPriceListRates = defineContract({
  method: 'PUT', path: '/price-lists/versions/:id/rates', auth: 'session', perm: 'prices:write', tx: write,
  input: z.object({
    id: idString(),
    rates: z.array(z.object({ itemId: idString(), rate: unitPriceString().nullable() })).min(1).max(500)
      .refine((rs) => new Set(rs.map((r) => r.itemId)).size === rs.length, 'Each item once'),
  }),
  output: z.object({}), errors: ['not_a_draft', 'unknown_item'],
});

/** A draft sent for approval as it is now; an earlier pending request for it is replaced. */
export const requestPriceListApproval = defineContract({
  method: 'POST', path: '/price-lists/versions/:id/approval', auth: 'session', perm: 'prices:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }), errors: ['not_a_draft'],
});

/** The approval routes (RAD-38): another person approves the exact version sent, or rejects it with a reason. */
export const priceListApproval = approvalContracts('price-list', 'prices:approve');

/** An item's price on a list: the rate in force and whether it includes GST. no_price: the list has no version in force,
 * or it doesn't price this item; a missing price is never read as 0. */
export const getPrice = defineContract({
  method: 'GET', path: '/price-lists/:id/price', auth: 'session', perm: 'prices:read', tx: read,
  input: z.object({ id: idString(), itemId: idString() }),
  output: z.object({ versionId: idString(), rate: unitPriceString(), taxInclusive: z.boolean() }), errors: ['no_price'],
});

// Discount limits (RAD-98): the most each role may take off a list price without a discount approval (M3).
const roleKey = () => z.string().regex(/^[a-z][a-z_]{1,31}$/, 'Not a role');

/** The default limit and each role's own. */
export const listDiscountLimits = defineContract({
  method: 'GET', path: '/sales/discount-limits', auth: 'session', perm: 'prices:read', tx: read, input: z.object({}),
  output: z.object({ default: percentString(), roles: z.array(z.object({ role: roleKey(), maxPercent: percentString() })) }),
});

/** A role's limit (`role` null: the default for roles without one); a null limit clears it. unknown_role: no such role. */
export const setDiscountLimit = defineContract({
  method: 'PUT', path: '/sales/discount-limits', auth: 'session', perm: 'prices:write', tx: write,
  input: z.object({ role: roleKey().nullable(), maxPercent: percentString().nullable(), reason: reason() }),
  output: z.object({}), errors: ['unknown_role'],
});
