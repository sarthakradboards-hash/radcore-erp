// The audit trail (RAD-30 part 2, ADR-005 §7c): the audit trigger's rows, read by an admin (audit:read) within a date
// range of at most AUDIT_RANGE_MAX_DAYS. Values arrive as stored: secret and personal-data columns were written as
// "[redacted]" (references, not copies, M6-16), so nothing of theirs could be unmasked. A cost column is kept as it is,
// so its values are masked here for a viewer without cost:read (COST_COLUMNS, ADR-001 §7a).
import { after, auditLog, changeReasons, onIndiaDays, platformTx } from '@radcore/db/platform';
import { vAuditedTables } from '@radcore/db/views';
import { addDays, maskOf } from '@radcore/lib-common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AUDIT_RANGE_MAX_DAYS, type listAuditedTables, type listAuditTrail } from './contract.ts';
import type { Ctx } from './ctx.ts';
import { AppError } from './errors.ts';
import { decodeCursor, encodeCursor, isoMoment, momentKey } from './lists.ts';
import { principalsOf } from './principals.ts';

type Input = z.output<typeof listAuditTrail.input>;
type Output = z.input<typeof listAuditTrail.output>;
type Row = Output['items'][number];

// The page key: occurred_at as stored, then seq, which orders one transaction's rows (they share occurred_at).
const pageKey = z.strictObject({ occurredAt: momentKey(), seq: z.number().int().positive() });
const REDACTED = '[redacted]';

/** The audited columns that hold a cost, by table (ADR-001 §7a): the audit trail masks their values for a viewer
 * without cost:read. Each cost column joins here in the PR that adds it; tools/cost-columns.test.ts fails on an audited
 * money column that's neither here nor on its list of columns that aren't costs. */
export const COST_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  items: Object.freeze(['purchase_price']),
  // Stock at cost: a movement's value and its per-unit rate (ADR-006 §4).
  stock_movements: Object.freeze(['value', 'rate']),
});

/** listAuditTrail (audit:read): newest first, within a date range of at most AUDIT_RANGE_MAX_DAYS India days. */
export async function listAuditTrailPage(ctx: Ctx, input: Input): Promise<Output> {
  const { occurred, tableName, recordId, principal, op } = input.filter;
  if (addDays(occurred.from, AUDIT_RANGE_MAX_DAYS - 1) < occurred.to) {
    throw new AppError('range_too_long', `Choose a range of at most ${String(AUDIT_RANGE_MAX_DAYS)} days`);
  }
  const key = input.after === undefined ? undefined : decodeCursor(pageKey, input.after);
  const tx = platformTx(ctx);
  const rows = await tx.select({
    id: auditLog.id, occurredAt: auditLog.occurredAt, seq: auditLog.seq, tableName: auditLog.tableName,
    recordId: auditLog.recordId, op: auditLog.op, changed: auditLog.changed, createdBy: auditLog.createdBy,
    reasonId: auditLog.reasonId,
  }).from(auditLog)
    .where(and(
      onIndiaDays(auditLog.occurredAt, occurred),
      tableName === undefined ? undefined : eq(auditLog.tableName, tableName),
      recordId === undefined ? undefined : eq(auditLog.recordId, recordId),
      principal === undefined ? undefined : eq(auditLog.createdBy, principalKey(principal)),
      op === undefined ? undefined : eq(auditLog.op, op),
      after([auditLog.occurredAt, auditLog.seq], key && [key.occurredAt, key.seq], 'desc'),
    ))
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.seq))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  // The names of the people on this page, in one read.
  const principalOf = await principalsOf(ctx, page.map((r) => r.createdBy));
  // The reasons on this page, in one read (RAD-36): the rows hold only their ids.
  const reasonIds = [...new Set(page.map((r) => r.reasonId).filter((r): r is string => r !== null))];
  const reasons = new Map(reasonIds.length === 0 ? [] : (await tx.select({ id: changeReasons.id, reason: changeReasons.reason })
    .from(changeReasons).where(inArray(changeReasons.id, reasonIds))).map((c) => [c.id, c.reason]));
  const last = page.at(-1);
  const seesCost = ctx.shows('cost');
  return {
    items: page.map((r) => ({
      id: r.id,
      occurredAt: isoMoment(r.occurredAt),
      principal: principalOf(r.createdBy),
      tableName: r.tableName,
      recordId: r.recordId,
      op: z.enum(['insert', 'update', 'delete']).parse(r.op),
      changed: changedOf(r.op, r.changed, seesCost ? [] : COST_COLUMNS[r.tableName] ?? []),
      reason: r.reasonId === null ? null : reasons.get(r.reasonId) ?? null,
    })),
    next: rows.length > input.limit && last ? encodeCursor({ occurredAt: last.occurredAt, seq: last.seq }) : null,
  };
}

/** listAuditedTables (audit:read): every table the audit trigger watches, for the viewer's filter. */
export async function listAuditedTablesList(ctx: Ctx): Promise<z.input<typeof listAuditedTables.output>> {
  const rows = await platformTx(ctx).select({ tableName: vAuditedTables.tableName }).from(vAuditedTables)
    .orderBy(asc(vAuditedTables.tableName));
  return { tables: rows.map((r) => r.tableName ?? '').filter((t) => t !== '') };
}

// The filter's principal as audit rows store it: a bare id is a user's (the screen's person picker sends one).
const principalKey = (p: string) => (p.includes(':') ? p : `user:${p}`);

// As stored (ADR-005 §7c): an insert's columns hold the new value, a delete's the old, an update's { old, new }; a
// redacted column holds "[redacted]" alone. The answer always says which side a value was on. A `hidden` column's
// values (a cost, for a viewer without cost:read) come back as the mask; a null stays null, as it gives nothing away.
const stored = z.record(z.string(), z.json());
function changedOf(op: string, changed: unknown, hidden: readonly string[]): Row['changed'] {
  return Object.fromEntries(Object.entries(stored.parse(changed)).map(([column, v]): [string, Row['changed'][string]] => {
    const shown = (x: z.output<ReturnType<typeof z.json>>) => (hidden.includes(column) && x !== null ? maskOf(x, 'cost') : x);
    if (op === 'insert') return [column, { new: shown(v) }];
    if (op === 'delete') return [column, { old: shown(v) }];
    if (v === REDACTED) return [column, { old: REDACTED, new: REDACTED }];
    const pair = z.object({ old: z.json(), new: z.json() }).parse(v);
    return [column, { old: shown(pair.old), new: shown(pair.new) }];
  }));
}
