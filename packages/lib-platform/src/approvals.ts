// Maker-checker (RAD-38, RC-037): the one approval rule every module uses. A module asks for approval of one record;
// a second person approves or rejects it. The engine knows no module (ADR-001 §8b): each kind supplies its
// ApprovalSpec, which says what version of the record is being approved and what approval or rejection does.
//   request ─► the record's version, hashed ─► a pending row (an older pending request for it is superseded)
//   decide  ─► lock the request ─► still pending ─► not the requester ─► the approver's account predates the request
//           ─► approve only: the record still hashes to the requested version, and the approver's screen saw it
//           ─► record the decision ─► the module's approved() or rejected(), in the same transaction
import { createHash } from 'node:crypto';
import { approvals, platformTx, users } from '@radcore/db/platform';
import { and, eq, isNull } from 'drizzle-orm';
import { principalId, type Ctx } from './ctx.ts';
import { AppError } from './errors.ts';

/** What a module gives the engine for one kind of approval (`purchase-order`, `stock-adjustment`, ...). */
export type ApprovalSpec<V> = {
  /** Lower-case words joined by hyphens. */
  readonly kind: string;
  /**
   * Exactly what the approver is shown and approves, as plain JSON values (money and quantities as strings): the
   * figures, not the whole row. Null when there's no such record. With `forUpdate`, it locks the record's row, so
   * nothing changes it between the check and the decision.
   */
  version(ctx: Ctx, recordId: string, options: { forUpdate: boolean }): Promise<V | null>;
  /** The record takes effect, in the approval's transaction. */
  approved(ctx: Ctx, recordId: string): Promise<void>;
  /** The record goes back to its maker, in the rejection's transaction. */
  rejected(ctx: Ctx, recordId: string, reason: string): Promise<void>;
};

/** The SHA-256 of a version as JSON with every object's keys sorted, so the same figures always hash the same. */
export function versionHash(version: unknown): string {
  const sorted = JSON.stringify(version, (_key, value: unknown) => typeof value === 'object' && value !== null
    && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : value);
  return createHash('sha256').update(sorted ?? '').digest('hex');
}

const notFound = () => new AppError('not_found', 'Not found');

/**
 * Asks for a second person's approval of the record as it is now. A pending request for the same record is
 * superseded, so an edit followed by a new request starts afresh. Returns the request's id and the version's hash.
 */
export async function requestApproval<V>(ctx: Ctx, spec: ApprovalSpec<V>, recordId: string): Promise<{ id: string; versionHash: string }> {
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

/** A request with the record as it is now: `changed` when it no longer hashes to the version requested. */
export async function showApproval<V>(ctx: Ctx, spec: ApprovalSpec<V>, id: string) {
  const [request] = await platformTx(ctx).select({ id: approvals.id, recordId: approvals.recordId, status: approvals.status,
    versionHash: approvals.versionHash, requestedBy: approvals.requestedBy, requestedAt: approvals.createdAt,
    decidedBy: approvals.decidedBy, decidedAt: approvals.decidedAt, reason: approvals.reason })
    .from(approvals).where(and(eq(approvals.id, id), eq(approvals.kind, spec.kind)));
  if (request === undefined) throw notFound();
  const version = await spec.version(ctx, request.recordId, { forUpdate: false });
  const current = version === null ? null : versionHash(version);
  return { ...request, version, currentHash: current, changed: current !== request.versionHash };
}

export type Decision =
  | { decision: 'approve'; versionHash: string }
  | { decision: 'reject'; reason: string };

/**
 * A second person's decision on a pending request (RC-037). Refused with `not_pending` once it's decided or
 * superseded, `own_request` for the requester, `approver_too_new` when the approver's account was made after the
 * request (so a requester can't invite someone new to approve their own), and, on approval, `version_changed` when
 * the record no longer hashes to the requested version or the approver's screen showed another.
 */
export async function decideApproval<V>(ctx: Ctx, spec: ApprovalSpec<V>, id: string, input: Decision): Promise<{ status: 'approved' | 'rejected' }> {
  // Only a person decides: a job, a webhook or a link never approves anything.
  if (ctx.principal.kind !== 'user') throw new AppError('forbidden', 'Only a person can decide an approval');
  const me = principalId(ctx.principal);
  const tx = platformTx(ctx);
  // Locked, so two people deciding at once are taken one after the other, and the second finds it decided.
  const [request] = await tx.select({ recordId: approvals.recordId, versionHash: approvals.versionHash,
    requestedBy: approvals.requestedBy, requestedAt: approvals.createdAt, decidedAt: approvals.decidedAt })
    .from(approvals).where(and(eq(approvals.id, id), eq(approvals.kind, spec.kind))).for('update');
  if (request === undefined) throw notFound();
  if (request.decidedAt !== null) throw new AppError('not_pending', 'This request was already decided, or a newer one replaced it');
  if (request.requestedBy === me) throw new AppError('own_request', 'You asked for this, so someone else must decide it');
  const [account] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, ctx.principal.userId));
  if (account === undefined || account.createdAt >= request.requestedAt) {
    throw new AppError('approver_too_new', 'Your account was made after this request, so you can\'t decide it');
  }
  if (input.decision === 'approve') {
    const version = await spec.version(ctx, request.recordId, { forUpdate: true });
    if (version === null || versionHash(version) !== request.versionHash || input.versionHash !== request.versionHash) {
      throw new AppError('version_changed', 'This changed since it was sent for approval. Ask for approval again');
    }
  }
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  await tx.update(approvals).set({ status, decidedBy: me, decidedAt: new Date(),
    ...(input.decision === 'reject' ? { reason: input.reason } : {}) }).where(eq(approvals.id, id));
  if (input.decision === 'approve') await spec.approved(ctx, request.recordId);
  else await spec.rejected(ctx, request.recordId, input.reason);
  return { status };
}
