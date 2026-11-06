// Factories for test data. Every built record gets its own random id and tag, so tests share no ids, never collide
// when run in parallel or in any order, and need no counter that one test could leave changed for the next (RC-222).
// Factories for tables arrive with the tickets that add the tables (RAD-49 Notes, point 3).
import { randomUUID } from 'node:crypto';

/** What a factory's build function gets for each record. */
export type Fresh = {
  /** A new UUID, for the record's id. */
  id: string;
  /** A short unique string, for names, codes and numbers that must be unique (`Party ${tag}`). */
  tag: string;
};

/**
 * Declare a factory: `const party = factory((f) => ({ id: f.id, name: `Party ${f.tag}`, gstin: null }))`.
 * Each call builds a new record; `party({ name: 'Acme' })` overrides fields.
 */
export function factory<T extends object>(build: (fresh: Fresh) => T): (overrides?: Partial<T>) => T {
  return (overrides = {}) => ({ ...build({ id: randomUUID(), tag: randomUUID().slice(0, 8) }), ...overrides });
}
