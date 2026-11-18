// Discount limits (M2-13, RAD-98): the most a person may take off a list price without a discount approval, by their
// role. A role with no limit of its own takes the default setting, sales.discount_limit_default: 0% (D-21, Sarthak on
// 18 Nov: "0%, approval needed"), so any discount needs approval unless a role's own limit allows it. An admin can
// change it without code. M3's quotes and bills ask discountAllowed for each line.
import { discountLimits, salesTx } from '@radcore/db/sales';
import { dec, percentString, type DecimalInput, type Percent } from '@radcore/lib-common';
import { AppError, defineSetting, saveSetting, type Ctx } from '@radcore/lib-platform';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { listDiscountLimits, setDiscountLimit } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** The limit for a role with none of its own: 0% (D-21, docs/decisions.md). */
const defaultDiscountLimit = defineSetting<string>('sales.discount_limit_default', percentString(), '0');

/** The most this person may take off a list price, in percent: their role's limit, else the default. A job, a link
 * or a person with no role has the default. */
export async function discountLimitFor(ctx: Ctx): Promise<Percent> {
  const role = ctx.principal.kind === 'user' ? ctx.principal.role : undefined;
  const [own] = role === undefined ? [] : await salesTx(ctx).select({ maxPercent: discountLimits.maxPercent })
    .from(discountLimits).where(eq(discountLimits.role, role));
  // A percent() column (numeric(9,6)) or a percentString() setting: a Percent either way.
  return (own?.maxPercent ?? ctx.settings.get(defaultDiscountLimit)) as Percent;
}

/** Whether this person may give a discount of `percent` on a list price without a discount approval. */
export async function discountAllowed(ctx: Ctx, percent: DecimalInput): Promise<boolean> {
  return dec(percent).lte(await discountLimitFor(ctx));
}

/** GET /sales/discount-limits (prices:read). */
export async function listLimits(ctx: Ctx): Promise<Out<typeof listDiscountLimits>> {
  const roles = await salesTx(ctx).select({ role: discountLimits.role, maxPercent: discountLimits.maxPercent })
    .from(discountLimits).orderBy(asc(discountLimits.role));
  return { default: ctx.settings.get(defaultDiscountLimit), roles };
}

/** PUT /sales/discount-limits (prices:approve): a role's limit set or cleared, or the default. The reason was kept by
 * the handler. */
export async function setLimit(ctx: Ctx, { role, maxPercent }: In<typeof setDiscountLimit>): Promise<Out<typeof setDiscountLimit>> {
  if (role === null) {
    await saveSetting(ctx, defaultDiscountLimit, maxPercent);
    return {};
  }
  const tx = salesTx(ctx);
  if (maxPercent === null) {
    await tx.delete(discountLimits).where(eq(discountLimits.role, role));
    return {};
  }
  try {
    await tx.insert(discountLimits).values({ role, maxPercent }).onConflictDoUpdate({ target: discountLimits.role, set: { maxPercent } });
  } catch (e) {
    if ((e as { cause?: { constraint?: string } }).cause?.constraint === 'discount_limits_role_roles_key_fk') {
      throw new AppError('unknown_role', 'There is no such role', [{ path: ['role'], code: 'unknown', message: 'Choose a role' }]);
    }
    throw e;
  }
  return {};
}
