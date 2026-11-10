// T1 fixture (ADR-001 §5): a service reads through ctx.tx. It must fail tsc.
import type { Ctx } from '@radcore/lib-platform';

export const f = (ctx: Ctx) => ctx.tx.query;
