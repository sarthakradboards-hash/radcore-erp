import { sql as s } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
export const t = pgTable('t', { a: text('a').default(s`'x'`) });
