// The sale checks' answer (M3-07, RAD-111), for each document that asks checkSale to put in its own answers,
// re-exported by ../contract.ts (#233). backend-2 writes this file and contract.ts only re-exports it, so the two never
// collide. Like every contract file it imports only zod and lib-common (D5).
import { cost, dateString, idString, moneyString, percentString, unitPriceString } from '@radcore/lib-common';
import { z } from 'zod';

/** Why a sale needs someone else's approval; a line's issue names the line by its index. */
export const checkIssue = z.discriminatedUnion('code', [
  z.object({ code: z.literal('over_limit') }),
  z.object({ code: z.literal('overdue') }),
  z.object({ code: z.literal('below_cost'), line: z.number().int().min(0) }),
  z.object({ code: z.literal('cost_unknown'), line: z.number().int().min(0) }),
  z.object({ code: z.literal('no_list_rate'), line: z.number().int().min(0) }),
  z.object({ code: z.literal('over_discount'), line: z.number().int().min(0) }),
]);

/**
 * A sale checked at one stage (RC-061, RC-131): the party's credit figures, each line's result, and the issues that
 * need approval (empty: none). A line's cost is masked without cost:read (RC-164, ADR-001 §7a); its result and the
 * issues aren't, so a person who can't see costs still sees that a line is below cost.
 */
export const saleCheck = z.object({
  stage: z.enum(['confirm', 'deliver', 'invoice', 'handback']),
  credit: z.object({
    /** The party's limit; null: none set, so it has no credit (Sarthak on RAD-111). */
    limit: moneyString().nullable(),
    /** Its net Debtors balance (an advance is negative). */
    outstanding: moneyString({ signed: true }),
    notInvoiced: moneyString(),
    adds: moneyString({ signed: true }),
    after: moneyString({ signed: true }),
    overLimit: z.boolean(),
    overdue: z.boolean(),
    oldestUnpaid: dateString().nullable(),
  }),
  lines: z.array(z.object({
    itemId: idString(),
    cost: cost(unitPriceString().nullable()),
    check: z.enum(['ok', 'below_cost', 'cost_unknown', 'not_priced']),
    discount: percentString(),
    overDiscount: z.boolean(),
  })),
  issues: z.array(checkIssue),
});
