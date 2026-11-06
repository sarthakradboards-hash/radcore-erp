import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';
export const c = check('x', sql`true`);
