import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
export const t = pgTable('t', { a: text('a').default(sql`'x'`) }, (c) => [check('a_set', sql`${c.a} <> ''`)]);
