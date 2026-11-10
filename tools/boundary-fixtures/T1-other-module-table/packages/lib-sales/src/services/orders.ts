// T1 fixture (ADR-001 §5): lib-sales reaches another module's table through its own module transaction. It must fail tsc.
import type { Ctx } from '@radcore/lib-platform';
import { salesTx } from '@radcore/db/sales';

export const f = (ctx: Ctx) => salesTx(ctx).query.parties;
