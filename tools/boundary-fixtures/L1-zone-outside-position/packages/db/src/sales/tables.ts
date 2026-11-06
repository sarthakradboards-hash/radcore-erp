import { sql } from 'drizzle-orm';
export const now = sql`now()`;
