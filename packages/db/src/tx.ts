// The opaque transaction (ADR-001 §5, T1). `ctx.tx` is a frozen object with no members, no symbols and no prototype:
// a service can only pass it on. The Drizzle transaction it stands for is held here, out of reach, and only a module
// transaction (module-tx.ts) can look it up. Once the transaction ends, the handle is dead.
import type { PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';

// The schema type is erased here: a module transaction reaches only its own tables, which it brings itself.
export type RawTx = PgTransaction<PgQueryResultHKT, Record<string, unknown>>;

// The brand's key is a symbol nothing exports, so no code outside this file can name it. The object never has it.
const opaque: unique symbol = Symbol('Tx');
/** A transaction a service can hold but not use. */
export type Tx = { readonly [opaque]: 'Tx' };

const live = new WeakMap<Tx, RawTx>();

/** A fresh handle for a transaction that has just begun. Only the opener (schema.ts) calls this. */
export function bind(raw: RawTx): Tx {
  // The brand is a type only, so the object carries nothing.
  const handle = Object.freeze(Object.create(null) as Tx);
  live.set(handle, raw);
  return handle;
}

/** Ends a handle: later use of it, or of a module transaction made from it, throws. */
export function unbind(handle: Tx): void {
  live.delete(handle);
}

export function rawOf(handle: Tx): RawTx {
  const raw = live.get(handle);
  if (raw === undefined) throw new Error('This transaction has ended, or never began');
  return raw;
}
