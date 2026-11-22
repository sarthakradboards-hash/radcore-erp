// PO limits (ADR-008 §5, RAD-136): the most a PO's total with GST may be for its placer to place it without someone
// else's approval, by the placer's role. A role with no limit of its own takes purchasing.order_limit_default: 0, so
// every PO is approved until an admin sets one (Sarthak, 22 Nov). Set as sales' discount limits are.
import { purchaseOrderLimits, purchasingTx } from '@radcore/db/purchasing';
import { moneyString, type Money } from '@radcore/lib-common';
import { AppError, defineSetting, saveSetting, type Ctx } from '@radcore/lib-platform';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { listPurchaseOrderLimits, setPurchaseOrderLimit } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** The limit for a role with none of its own: 0 (Sarthak, 22 Nov: "0 — every PO approved"). */
export const ORDER_LIMIT_DEFAULT = defineSetting<string>('purchasing.order_limit_default', moneyString(), '0.00', {
  label: 'Purchase order limit',
  description: 'The most a purchase order’s total with GST may be for a person whose role has no limit of its own to place it '
    + 'without approval. 0 sends every purchase order for approval.',
  input: { kind: 'money' },
});

/** The principal's role, the one their limit is read by: a job or a person with no role has none. */
export const roleOf = (ctx: Ctx): string | null => (ctx.principal.kind === 'user' ? ctx.principal.role ?? null : null);

/** A role's limit: its own, else the default. No role (a job, or a person with none) has the default. */
export async function orderLimitOf(ctx: Ctx, role: string | null = roleOf(ctx)): Promise<Money> {
  const [own] = role === null ? [] : await purchasingTx(ctx).select({ maxTotal: purchaseOrderLimits.maxTotal })
    .from(purchaseOrderLimits).where(eq(purchaseOrderLimits.role, role));
  return (own?.maxTotal ?? ctx.settings.get(ORDER_LIMIT_DEFAULT)) as Money;
}

/** GET /purchasing/order-limits (purchasing:read). */
export async function listOrderLimits(ctx: Ctx): Promise<Out<typeof listPurchaseOrderLimits>> {
  const roles = await purchasingTx(ctx).select({ role: purchaseOrderLimits.role, maxTotal: purchaseOrderLimits.maxTotal })
    .from(purchaseOrderLimits).orderBy(asc(purchaseOrderLimits.role));
  return { defaultMaxTotal: ctx.settings.get(ORDER_LIMIT_DEFAULT), roles };
}

/** PUT /purchasing/order-limits (purchasing:approve): a role's limit set or cleared, or the default (null resets it to
 * 0). The reason was kept by the handler. */
export async function setOrderLimit(ctx: Ctx, { role, maxTotal }: In<typeof setPurchaseOrderLimit>): Promise<Out<typeof setPurchaseOrderLimit>> {
  if (role === null) {
    await saveSetting(ctx, ORDER_LIMIT_DEFAULT, maxTotal);
    return {};
  }
  const tx = purchasingTx(ctx);
  if (maxTotal === null) {
    await tx.delete(purchaseOrderLimits).where(eq(purchaseOrderLimits.role, role));
    return {};
  }
  try {
    await tx.insert(purchaseOrderLimits).values({ role, maxTotal }).onConflictDoUpdate({ target: purchaseOrderLimits.role, set: { maxTotal } });
  } catch (e) {
    if ((e as { cause?: { constraint?: string } }).cause?.constraint === 'purchase_order_limits_role_roles_key_fk') {
      throw new AppError('unknown_role', 'There is no such role', [{ path: ['role'], code: 'unknown', message: 'Choose a role' }]);
    }
    throw e;
  }
  return {};
}
