import { sql } from 'drizzle-orm';
import { pgView, text } from 'drizzle-orm/pg-core';
export const o = pgView('o', { a: text('a') }).with({ securityInvoker: true }).as(sql`select a from t`);
