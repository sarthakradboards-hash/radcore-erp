import { sql } from 'drizzle-orm';
import { pgView, text } from 'drizzle-orm/pg-core';
export const v = pgView('v', { a: text('a') }).as(sql`select a from t`);
