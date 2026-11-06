import { sql } from 'drizzle-orm';
import { pgMaterializedView, text } from 'drizzle-orm/pg-core';
export const m = pgMaterializedView('m', { a: text('a') }).as(sql`select a from t`);
