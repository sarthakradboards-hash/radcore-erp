import { sql } from 'drizzle-orm';
export function applyRequestContext(tx: { execute(q: unknown): unknown }, id: string) {
  return tx.execute(sql`select set_config('app.principal', ${id}, true)`);
}
