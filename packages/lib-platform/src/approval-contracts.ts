// The approval contracts (maker-checker, RAD-38, ADR-001 §8b), re-exported by ./contract. Like every contract file it
// imports only zod and lib-common (D5), so the browser can load it.
import { defineContract, idString, listInput, listOf, momentString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/**
 * One kind of approval's three routes (maker-checker, RAD-38, ADR-001 §8b, RC-037), under one static permission: a
 * module's contract.ts declares `approvalContracts('purchase-order', 'purchasing:approve')`, and its route file spreads
 * `...defineApproval(contracts, spec)`.
 * - listPending: the oldest pending requests within the approver's scope.
 * - getApproval: one request with the record's version as it is now. `versionHash` is what was requested,
 *   `currentHash` what the record hashes to now, and `changed` says they differ (then it can only be rejected).
 * - decide: approve the version the screen showed (`versionHash`), or reject with a reason. Refused with
 *   `own_request`, `approver_too_new`, `version_changed` or `not_pending`.
 */
export const approvalContracts = <K extends string>(kind: K, perm: `${string}:${string}`) => {
  const request = z.object({
    id: idString(), recordId: idString(), status: z.enum(['pending', 'approved', 'rejected', 'superseded']),
    requestedBy: z.string(), requestedAt: momentString(),
    decidedBy: z.string().nullable(), decidedAt: momentString().nullable(), reason: z.string().nullable(),
  });
  const hash = () => z.string().regex(/^[0-9a-f]{64}$/, 'Not a version');
  return Object.freeze({
    listPending: defineContract({
      method: 'GET', path: `/approvals/${kind}`, auth: 'session', perm, tx: read,
      input: listInput(z.object({})),
      output: listOf(z.object({ id: idString(), recordId: idString(), requestedBy: z.string(), requestedAt: momentString() })),
    }),
    getApproval: defineContract({
      method: 'GET', path: `/approvals/${kind}/:id`, auth: 'session', perm, tx: read,
      input: z.object({ id: idString() }),
      output: request.extend({ version: z.json(), versionHash: hash(), currentHash: hash(), changed: z.boolean() }),
    }),
    decide: defineContract({
      method: 'POST', path: `/approvals/${kind}/:id/decision`, auth: 'session', perm, tx: write,
      input: z.object({ id: idString(), decision: z.enum(['approve', 'reject']), versionHash: hash().optional(),
        reason: z.string().trim().min(1, 'Say why, in your own words').max(500).optional() })
        .refine((d) => d.decision === 'reject' || d.versionHash !== undefined, { path: ['versionHash'], error: 'Approve the version you saw' })
        .refine((d) => d.decision === 'approve' || d.reason !== undefined, { path: ['reason'], error: 'Say why, in your own words' }),
      output: z.object({ status: z.enum(['approved', 'rejected']) }),
      errors: ['own_request', 'approver_too_new', 'version_changed', 'not_pending'],
    }),
  });
};
