// The partitioned logs, declared for typed reads only (ADR-005 §8): Drizzle can't declare a partitioned table, so their
// hand-written migrations (0011, 0014) make them, and this file sits outside drizzle.config.ts's schema glob so
// generate leaves them alone. The app can't insert, update or delete any of them (ADR-005 §7c).
import { bigint, inet, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { radcore } from '../columns.ts';

/** Every change to an audited table (RAD-30): written only by the audit trigger, read by listAuditTrail, and by
 * maker-checker for who changed a record or its parts (RAD-38). `owner_id` is a part row's record (audit_attach's `owner =>`). */
export const auditLog = radcore.table('audit_log', {
  id: uuid().notNull(),
  // As a string, as lists.ts's onIndiaDays and after compare it, keeping the microseconds (momentKey).
  occurredAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  // Taken at insert, from one sequence: the order rows were written, which occurred_at (a transaction's start) isn't.
  seq: bigint({ mode: 'number' }).notNull(),
  tableName: text().notNull(),
  recordId: text().notNull(),
  ownerId: text(),
  op: text().notNull(),
  changed: jsonb().notNull(),
  createdBy: text().notNull(),
});

/** Security events (RAD-31): written only through record_event, read by listSecurityEvents. */
export const eventLog = radcore.table('event_log', {
  id: uuid().notNull(),
  // As a string, as lists.ts's onIndiaDays and after compare it.
  occurredAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  seq: bigint({ mode: 'number' }).notNull(),
  kind: text().notNull(),
  userId: uuid(),
  device: text(),
  detail: jsonb().notNull(),
  loginName: text().notNull(),
  clientAddr: inet(),
  createdAt: timestamp({ withTimezone: true }).notNull(),
  createdBy: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull(),
  updatedBy: text().notNull(),
});
