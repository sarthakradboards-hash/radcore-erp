import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';
export const raw = (s: string) => check('x', sql`${sql.raw(s)}`);
