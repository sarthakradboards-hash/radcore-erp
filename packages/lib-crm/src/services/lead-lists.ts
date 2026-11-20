// The CRM's own lists (M3-05, RAD-109): lost reasons, follow-up plans and quick replies, which leads:setup keeps up
// and anyone with leads:read reads (the architect: a list people keep up is a master table, not a setting). A lead
// names an item by id with a restrict key, so an item in use is switched off, never deleted. Each is audited.
import { crmTx, followUpPlanSteps, followUpPlans, leadLostReasons, quickReplies } from '@radcore/db/crm';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  createLostReason, createPlan, createQuickReply, getLeadLists, updateLostReason, updatePlan, updateQuickReply,
} from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

// Each list's unique name, as the database refuses a second one, answered on its field.
const NAME_KEYS: Readonly<Record<string, string>> = {
  ux_lead_lost_reasons_label_key: 'label', ux_follow_up_plans_name_key: 'name', ux_quick_replies_title_key: 'title',
};
async function named<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (e) {
    const field = NAME_KEYS[(e as { cause?: { constraint?: string } }).cause?.constraint ?? ''];
    if (field !== undefined) {
      throw new AppError('name_taken', 'Another one already has this name', [{ path: [field], code: 'taken', message: 'Choose another name' }]);
    }
    throw e;
  }
}
const notFound = () => new AppError('not_found', 'There is no such item');

/** GET /lead-lists (leads:read): every item, switched off too, by name. */
export async function leadLists(ctx: Ctx): Promise<Out<typeof getLeadLists>> {
  const tx = crmTx(ctx);
  const lostReasons = await tx.select({ id: leadLostReasons.id, label: leadLostReasons.label, active: leadLostReasons.active })
    .from(leadLostReasons).orderBy(asc(leadLostReasons.labelKey));
  const plans = await tx.select({ id: followUpPlans.id, name: followUpPlans.name, active: followUpPlans.active })
    .from(followUpPlans).orderBy(asc(followUpPlans.nameKey));
  const steps = await tx.select({ planId: followUpPlanSteps.planId, step: followUpPlanSteps.step, afterDays: followUpPlanSteps.afterDays,
    note: followUpPlanSteps.note }).from(followUpPlanSteps).orderBy(asc(followUpPlanSteps.step));
  const quick = await tx.select({ id: quickReplies.id, title: quickReplies.title, body: quickReplies.body, active: quickReplies.active })
    .from(quickReplies).orderBy(asc(quickReplies.titleKey));
  return {
    lostReasons,
    plans: plans.map((p) => ({ ...p, steps: steps.filter((s) => s.planId === p.id).map(({ planId: _, ...s }) => s) })),
    quickReplies: quick,
  };
}

/** POST /lead-lists/lost-reasons (leads:setup). */
export async function addLostReason(ctx: Ctx, { label }: In<typeof createLostReason>): Promise<Out<typeof createLostReason>> {
  const [row] = await named(crmTx(ctx).insert(leadLostReasons).values({ label }).returning({ id: leadLostReasons.id }));
  if (row === undefined) throw new Error('an insert returned no row');
  return row;
}

/** PUT /lead-lists/lost-reasons/:id (leads:setup). */
export async function changeLostReason(ctx: Ctx, { id, label, active }: In<typeof updateLostReason>): Promise<Out<typeof updateLostReason>> {
  const [row] = await named(crmTx(ctx).update(leadLostReasons).set({ label, active }).where(eq(leadLostReasons.id, id))
    .returning({ id: leadLostReasons.id }));
  if (row === undefined) throw notFound();
  return {};
}

const stepRows = (planId: string, steps: In<typeof createPlan>['steps']) =>
  steps.map((s, n) => ({ planId, step: n + 1, afterDays: s.afterDays, note: s.note }));

/** POST /lead-lists/plans (leads:setup): its steps numbered 1 up, in the order given. */
export async function addPlan(ctx: Ctx, { name, steps }: In<typeof createPlan>): Promise<Out<typeof createPlan>> {
  const tx = crmTx(ctx);
  const [row] = await named(tx.insert(followUpPlans).values({ name }).returning({ id: followUpPlans.id }));
  if (row === undefined) throw new Error('an insert returned no row');
  await tx.insert(followUpPlanSteps).values(stepRows(row.id, steps));
  return row;
}

/** PUT /lead-lists/plans/:id (leads:setup): the plan's row is locked by its update, so two rewrites take turns. */
export async function changePlan(ctx: Ctx, { id, name, active, steps }: In<typeof updatePlan>): Promise<Out<typeof updatePlan>> {
  const tx = crmTx(ctx);
  const [row] = await named(tx.update(followUpPlans).set({ name, active }).where(eq(followUpPlans.id, id)).returning({ id: followUpPlans.id }));
  if (row === undefined) throw notFound();
  await tx.delete(followUpPlanSteps).where(eq(followUpPlanSteps.planId, id));
  await tx.insert(followUpPlanSteps).values(stepRows(id, steps));
  return {};
}

/** POST /lead-lists/quick-replies (leads:setup). */
export async function addQuickReply(ctx: Ctx, { title, body }: In<typeof createQuickReply>): Promise<Out<typeof createQuickReply>> {
  const [row] = await named(crmTx(ctx).insert(quickReplies).values({ title, body }).returning({ id: quickReplies.id }));
  if (row === undefined) throw new Error('an insert returned no row');
  return row;
}

/** PUT /lead-lists/quick-replies/:id (leads:setup). */
export async function changeQuickReply(ctx: Ctx, { id, title, body, active }: In<typeof updateQuickReply>): Promise<Out<typeof updateQuickReply>> {
  const [row] = await named(crmTx(ctx).update(quickReplies).set({ title, body, active }).where(eq(quickReplies.id, id))
    .returning({ id: quickReplies.id }));
  if (row === undefined) throw notFound();
  return {};
}
