// T1 fixture (ADR-001 §5): a module transaction writes only its own tables, by type. It must fail tsc. (A table typed
// only as PgTable passes the type once the module has tables of its own; moduleTx refuses it at run time instead.)
import type { Ctx } from '@radcore/lib-platform';
import { salesTx } from '@radcore/db/sales';
import { items } from '@radcore/db/stock';

export const f = (ctx: Ctx) => salesTx(ctx).insert(items);
