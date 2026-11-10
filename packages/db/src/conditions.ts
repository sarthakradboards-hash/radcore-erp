// Conditions Drizzle gets wrong for this codebase (ADR-002 §4). Drizzle 0.45.4's `notInArray(col, [])` is `sql\`true\``,
// which would turn an update or delete into a whole-table write, so `notInArray` is off L1's allowlist and this is
// the way to exclude a list.
import { notInArray, type Column, type SQL } from 'drizzle-orm';

/** `col NOT IN (list)`, refusing an empty list instead of matching every row. */
export function notInNonEmpty<T>(col: Column, list: readonly T[]): SQL {
  if (list.length === 0) throw new RangeError('notInNonEmpty: the list is empty, which would match every row');
  return notInArray(col, [...list]);
}
