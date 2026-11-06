import { sql } from 'drizzle-orm';
function other() {
  return sql`select 1`;
}
export function applyRequestContext() {
  return other();
}
