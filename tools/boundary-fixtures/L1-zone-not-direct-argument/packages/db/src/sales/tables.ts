import { sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
export const t = pgTable('t', { a: text('a').default(wrap(sql`'x'`)) });
