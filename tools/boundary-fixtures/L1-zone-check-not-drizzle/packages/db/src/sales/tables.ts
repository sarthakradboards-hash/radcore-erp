import { sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
const check = (n: string, s: unknown) => [n, s];
export const t = pgTable('t', { a: text('a') }, () => [check('c', sql`true`)]);
