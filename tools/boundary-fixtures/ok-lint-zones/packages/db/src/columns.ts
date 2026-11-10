import { sql } from 'drizzle-orm';
import { numeric, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';
export const id = () => uuid('id').primaryKey();
export const auditColumns = { createdAt: timestamp('created_at').notNull().default(sql`now()`), updatedAt: timestamp('updated_at') };
export const audit = () => ({ ...auditColumns, deletedAt: timestamp('deleted_at') });
export function money(name: string) {
  const precision = 14;
  return numeric(name, { precision, scale: 2 });
}
export type Id = string;
export const radcore = pgSchema('radcore');
