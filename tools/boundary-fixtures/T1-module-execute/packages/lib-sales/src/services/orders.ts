// T1 fixture (ADR-001 §5): a module transaction has no execute. It must fail tsc.
import type { Ctx } from '@radcore/lib-platform';
import { salesTx } from '@radcore/db/sales';

export const f = (ctx: Ctx) => salesTx(ctx).execute;
