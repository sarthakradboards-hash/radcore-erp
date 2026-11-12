// Maker-checker (RAD-38, RC-037): the one approval rule every module uses. A module asks for approval of one record;
// a second person approves or rejects it. The engine knows no module (ADR-001 §8b): each kind supplies its
// ApprovalSpec, which says what version of the record is being approved and what approval or rejection does.
//   request ─► the record's version, hashed ─► a pending row (an older pending request for it is superseded)
//   decide  ─► the record, locked and within the approver's scope (else not_found) ─► lock the request ─► still pending
//           ─► not the requester, and no change by them to the record or its parts since its last approval (audit log)
//           ─► the approver's account predates the request
//           ─► approve only: the record still hashes to the requested version, and the approver's screen saw it
//           ─► the module's approved() or rejected() ─► record the decision (only while still pending), same transaction
// A module's route file spreads `...defineApproval(contracts, spec)` (ADR-001 §8b), with its `approvalContracts`.
import { createHash } from 'node:crypto';
import { approvals, auditLog, platformTx, users } from '@radcore/db/platform';
import { and, asc, eq, gt, inArray, isNull, like, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { approvalContracts } from './approval-contracts.ts';
import { principalId, type Ctx } from './ctx.ts';
import { AppError } from './errors.ts';
import { defineRoute, type Route } from './route.ts';

/** A version is plain JSON: what the approver's screen shows, and what's hashed. */
export type ApprovalVersion = z.output<ReturnType<typeof z.json>>;

/** What a module gives the engine for one kind of approval (`purchase-order`, `stock-adjustment`, ...). */
export type ApprovalSpec<V extends ApprovalVersion = ApprovalVersion> = {
  /** Lower-case words joined by hyphens, the same as its approvalContracts' kind. */
  readonly kind: string;
  /** The record's own table (`purchase_orders`), audited, keyed by the record's id. */
  readonly table: string;
  /** Its part tables (`purchase_order_lines`), each attached with `owner =>` its record's key column, so their audit
   * rows carry the record's id. A change to a part is a change to the record (ADR-001 §8b). */
  readonly parts?: readonly string[];
  /**
   * Exactly what the approver is shown and approves, as plain JSON values (money and quantities as strings): the
   * figures, not the whole row. With `forUpdate`, it locks the record's row, so nothing changes it between the check
   * and the decision.
   * Null when there's no such record, or it's outside the principal's record scope (ctx.can, M1-17): the engine then
   * answers not_found and leaves it out of the pending list, so an approver sees and decides only what they may.
   * shortcut: record scope arrives with RAD-35's ctx.can; until then a module's version() finds any record, and
   * RAD-35 adds the test that an out-of-scope approver gets 404.
   */
  version(ctx: Ctx, recordId: string, options: { forUpdate: boolean }): Promise<V | null>;
  /** The record takes effect, in the approval's transaction. */
  approved(ctx: Ctx, recordId: string): Promise<void>;
  /** The record goes back to its maker, in the rejection's transaction. */
  rejected(ctx: Ctx, recordId: string, reason: string): Promise<void>;
};

/** The SHA-256 of a version as JSON with every object's keys sorted, so the same figures always hash the same. */
export function versionHash(version: ApprovalVersion): string {
  const sorted = JSON.stringify(version, (_key, value: unknown) => typeof value === 'object' && value !== null
    && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : value);
  return createHash('sha256').update(sorted).digest('hex');
}

const notFound = () => new AppError('not_found', 'Not found');
const notPending = () => new AppError('not_pending', 'This request was already decided, or a newer one replaced it');

/**
 * Asks for a second person's approval of the record as it is now. A pending request for the same record is
 * superseded, so an edit followed by a new request starts afresh. Returns the request's id and the version's hash.
 */
export async function requestApproval<V extends ApprovalVersion>(ctx: Ctx, spec: ApprovalSpec<V>, recordId: string,
): Promise<{ id: string; versionHash: string }> {
  const version = await spec.version(ctx, recordId, { forUpdate: true });
  if (version === null) throw notFound();
  const hash = versionHash(version);
  const tx = platformTx(ctx);
  await tx.update(approvals).set({ status: 'superseded', decidedAt: new Date() })
    .where(and(eq(approvals.kind, spec.kind), eq(approvals.recordId, recordId), isNull(approvals.decidedAt)));
  const [row] = await tx.insert(approvals)
    .values({ kind: spec.kind, recordId, versionHash: hash, requestedBy: principalId(ctx.principal) }).returning({ id: approvals.id });
  if (row === undefined) throw new Error('the approval request was not stored');
  return { id: row.id, versionHash: hash };
}

type Status = 'pending' | 'approved' | 'rejected' | 'superseded';

/** The oldest pending requests of a kind whose records are within the principal's scope (version() isn't null). */
export async function listPendingApprovals<V extends ApprovalVersion>(ctx: Ctx, spec: ApprovalSpec<V>, { limit }: { limit: number }) {
  // shortcut: the oldest `limit` pending requests and no next page. An approval queue is short; a cursor joins when one
  // outgrows a page (created_at's microseconds need the lists helpers' text key).
  const rows = await platformTx(ctx).select({ id: approvals.id, recordId: approvals.recordId,
    requestedBy: approvals.requestedBy, requestedAt: approvals.createdAt })
    .from(approvals).where(and(eq(approvals.kind, spec.kind), isNull(approvals.decidedAt)))
    .orderBy(asc(approvals.createdAt), asc(approvals.id)).limit(limit);
  const items: { id: string; recordId: string; requestedBy: string; requestedAt: string }[] = [];
  for (const r of rows) {
    if (await spec.version(ctx, r.recordId, { forUpdate: false }) !== null) items.push({ ...r, requestedAt: r.requestedAt.toISOString() });
  }
  return { items, next: null };
}

/** A request with the record as it is now: `changed` when it no longer hashes to the version requested. */
export async function showApproval<V extends ApprovalVersion>(ctx: Ctx, spec: ApprovalSpec<V>, id: string) {
  const [request] = await platformTx(ctx).select({ id: approvals.id, recordId: approvals.recordId, status: approvals.status,
    versionHash: approvals.versionHash, requestedBy: approvals.requestedBy, requestedAt: approvals.createdAt,
    decidedBy: approvals.decidedBy, decidedAt: approvals.decidedAt, reason: approvals.reason })
    .from(approvals).where(and(eq(approvals.id, id), eq(approvals.kind, spec.kind)));
  if (request === undefined) throw notFound();
  const version = await spec.version(ctx, request.recordId, { forUpdate: false });
  if (version === null) throw notFound();
  const current = versionHash(version);
  // The table's CHECK holds status to these four.
  return { ...request, status: request.status as Status, requestedAt: request.requestedAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null, version, currentHash: current, changed: current !== request.versionHash };
}

export type Decision =
  | { decision: 'approve'; versionHash: string }
  | { decision: 'reject'; reason: string };

/**
 * A second person's decision on a pending request (RC-037). Refused with not_found when the record is outside the
 * approver's scope, `not_pending` once it's decided or superseded, `own_request` for the requester,
 * `approver_too_new` when the approver's account was made after the request (so a requester can't invite someone new
 * to approve their own), and, on approval, `version_changed` when the record no longer hashes to the requested
 * version or the approver's screen showed another.
 */
export async function decideApproval<V extends ApprovalVersion>(ctx: Ctx, spec: ApprovalSpec<V>, id: string, input: Decision,
): Promise<{ status: 'approved' | 'rejected' }> {
  // Only a person decides: a job, a webhook or a link never approves anything.
  if (ctx.principal.kind !== 'user') throw new AppError('forbidden', 'Only a person can decide an approval');
  const me = principalId(ctx.principal);
  const tx = platformTx(ctx);
  const [found] = await tx.select({ recordId: approvals.recordId }).from(approvals)
    .where(and(eq(approvals.id, id), eq(approvals.kind, spec.kind)));
  if (found === undefined) throw notFound();
  // The record first, locked, then the request: requestApproval locks in the same order, so a request and a decision
  // at once never deadlock (auditor). Outside the approver's scope the record is not found, for either decision.
  const version = await spec.version(ctx, found.recordId, { forUpdate: true });
  if (version === null) throw notFound();
  // The request locked too, so two people deciding at once are taken one after the other: the second finds it decided.
  const [request] = await tx.select({ recordId: approvals.recordId, versionHash: approvals.versionHash,
    requestedBy: approvals.requestedBy, requestedAt: approvals.createdAt, decidedAt: approvals.decidedAt })
    .from(approvals).where(eq(approvals.id, id)).for('update');
  if (request === undefined) throw notFound();
  if (request.decidedAt !== null) throw notPending();
  if (request.requestedBy === me || (await makersSinceApproval(ctx, spec, request.recordId)).includes(me)) {
    throw new AppError('own_request', 'You asked for this or changed it, so someone else must decide it');
  }
  const [account] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, ctx.principal.userId));
  if (account === undefined || account.createdAt >= request.requestedAt) {
    throw new AppError('approver_too_new', 'Your account was made after this request, so you can\'t decide it');
  }
  if (input.decision === 'approve' && (versionHash(version) !== request.versionHash || input.versionHash !== request.versionHash)) {
    throw new AppError('version_changed', 'This changed since it was sent for approval. Ask for approval again');
  }
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  // The module's part first, then the status: the approval's audit row is then the transaction's last, so what
  // approved() wrote comes before it by audit_log.seq and never makes the approver a maker of the next approval.
  if (input.decision === 'approve') await spec.approved(ctx, request.recordId);
  else await spec.rejected(ctx, request.recordId, input.reason);
  // A decision changes only the record's status and decision fields, never what is approved (ADR-001 §8b): that's why
  // the maker read can leave its writes out. A spec that breaks the rule fails here, and the decision rolls back.
  const after = await spec.version(ctx, request.recordId, { forUpdate: false });
  if (after === null || versionHash(after) !== versionHash(version)) {
    throw new Error(`approval ${spec.kind}: its ${input.decision === 'approve' ? 'approved' : 'rejected'}() changed what is approved`);
  }
  // Only while still pending, so of two decisions at once only one is recorded (the row lock already orders them);
  // the other rolls back, its module part with it.
  const [decided] = await tx.update(approvals).set({ status, decidedBy: me, decidedAt: new Date(),
    ...(input.decision === 'reject' ? { reason: input.reason } : {}) })
    .where(and(eq(approvals.id, id), isNull(approvals.decidedAt))).returning({ id: approvals.id });
  if (decided === undefined) throw notPending();
  return { status };
}

/**
 * Everyone who changed the record or one of its parts since its last approval, or ever if it was never approved, as
 * the audit log records them (ADR-001 §8b): the record's own rows, and its parts' rows by owner_id. Only people: a
 * job isn't a maker. "Since" is by audit_log.seq, taken when each row is written, not occurred_at (its transaction's
 * start): a save that began before the approval but wrote after it still counts (auditor). The approving transaction's
 * own writes (approved()) come before its status change, so they don't. Left over: a part written before the approval
 * but committed after it (§8b's known limit).
 */
async function makersSinceApproval<V extends ApprovalVersion>(ctx: Ctx, spec: ApprovalSpec<V>, recordId: string): Promise<string[]> {
  const tx = platformTx(ctx);
  const decided = await tx.select({ id: approvals.id, status: approvals.status, by: approvals.decidedBy }).from(approvals)
    .where(and(eq(approvals.kind, spec.kind), eq(approvals.recordId, recordId), inArray(approvals.status, ['approved', 'rejected'])));
  // Each decision's own audit row (its status change, written by the decider): its seq bounds "since", and its
  // transaction (decider and time) marks what approved() or rejected() wrote, which is the decision, not a change.
  const decisions = decided.length === 0 ? [] : await tx.select({ id: auditLog.recordId, by: auditLog.createdBy,
    at: auditLog.occurredAt, seq: auditLog.seq }).from(auditLog)
    .where(and(eq(auditLog.tableName, 'approvals'), inArray(auditLog.recordId, decided.map((d) => d.id))));
  const byDecider = decisions.filter((r) => decided.some((d) => d.id === r.id && d.by === r.by));
  const approvedIds = new Set(decided.filter((d) => d.status === 'approved').map((d) => d.id));
  const last = Math.max(0, ...byDecider.filter((r) => approvedIds.has(r.id)).map((r) => r.seq));
  const parts = spec.parts ?? [];
  const rows = await tx.select({ by: auditLog.createdBy, at: auditLog.occurredAt }).from(auditLog).where(and(
    last === 0 ? undefined : gt(auditLog.seq, last),
    like(auditLog.createdBy, 'user:%'),
    or(and(eq(auditLog.tableName, spec.table), eq(auditLog.recordId, recordId)),
      parts.length === 0 ? undefined : and(inArray(auditLog.tableName, [...parts]), eq(auditLog.ownerId, recordId)))))
    .groupBy(auditLog.createdBy, auditLog.occurredAt);
  // A rejection's rejected() wrote the record as the rejecter, and that's no change of theirs (auditor): reject, fix
  // and approve again by the same person must work.
  const inDecision = (r: { by: string; at: string }) => byDecider.some((d) => d.by === r.by && d.at === r.at);
  return [...new Set(rows.filter((r) => !inDecision(r)).map((r) => r.by))];
}

type ApprovalContracts = ReturnType<typeof approvalContracts>;
const KIND_PATH = /^\/approvals\/([a-z][a-z0-9-]*)$/;

/**
 * One kind of approval's three routes (ADR-001 §8b): the module's `approvalContracts(kind, perm)` with its spec. A
 * route file spreads them: `...defineApproval(purchasing.contracts.poApproval, purchasing.poApproval)`.
 */
export function defineApproval<V extends ApprovalVersion>(contracts: ApprovalContracts, spec: ApprovalSpec<V>): readonly Route[] {
  const kind = KIND_PATH.exec(contracts.listPending.path)?.[1];
  if (kind !== spec.kind) throw new TypeError(`approval ${spec.kind}: its contracts are for ${String(kind)}`);
  return Object.freeze([
    defineRoute(contracts.listPending, (ctx, input) => listPendingApprovals(ctx, spec, input)),
    defineRoute(contracts.getApproval, (ctx, { id }) => showApproval(ctx, spec, id)),
    // The contract refuses an approval without the version seen, and a rejection without a reason.
    defineRoute(contracts.decide, (ctx, { id, decision, versionHash: seen, reason }) => decideApproval(ctx, spec, id,
      decision === 'approve' ? { decision, versionHash: seen ?? '' } : { decision, reason: reason ?? '' })),
  ]);
}
