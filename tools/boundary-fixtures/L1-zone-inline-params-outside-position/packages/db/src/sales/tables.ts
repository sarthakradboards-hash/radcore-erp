import { sql } from 'drizzle-orm';
const part = sql`select ${1}`.inlineParams();
export type Part = typeof part;
