// T1 fixture (ADR-001 §5): a module transaction writes only its own tables, by type. It must fail tsc.
import type { Ctx } from '@radcore/lib-platform';
import { salesTx } from '@radcore/db/sales';
import type { PgTable } from 'drizzle-orm/pg-core';

export const f = (ctx: Ctx, other: PgTable) => salesTx(ctx).insert(other);
