// Lead sources and what they set aside (M3-06, RAD-110; the architect's rulings), under leads:setup. Each door has
// its own source, seeded with it; a person adds more for capture by hand or at the counter. An outside door's source
// can be ignored: its new enquiries are then stored and set aside by capture (leads.ts), never made leads. Only an
// outside door's can be: the CHECK ck_lead_sources_ignorable refuses the rest, answered by the contract as
// source_not_ignorable (RC-212). Every change is audited.
import { after, crmTx, leadSetAsides, leadSources } from '@radcore/db/crm';
import { maskOf } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, isoMoment, momentKey, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { createLeadSource, listLeadSources, listSetAside, updateLeadSource } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Channel = Out<typeof listLeadSources>['sources'][number]['channel'];

// The moment as PostgreSQL writes it, to the microsecond (#316, #325): a Date's would repeat or skip rows.
const PAGE_KEY = z.object({ at: momentKey(), id: z.uuid() });

/** GET /crm/lead-sources (leads:setup): the doors' own first, then the rest, by name. */
export async function leadSourcesList(ctx: Ctx): Promise<Out<typeof listLeadSources>> {
  const rows = await crmTx(ctx).select().from(leadSources).orderBy(asc(isNull(leadSources.doorChannel)), asc(leadSources.nameKey));
  return { sources: rows.map((r) => ({ id: r.id, name: r.name, channel: r.channel as Channel, door: r.doorChannel !== null, active: r.active,
    ignored: r.ignored })) };
}

/** POST /crm/lead-sources (leads:setup): a source for capture by hand or at the counter. */
export async function addLeadSource(ctx: Ctx, { name, channel }: In<typeof createLeadSource>): Promise<Out<typeof createLeadSource>> {
  const [row] = await crmTx(ctx).insert(leadSources).values({ name, channel }).returning({ id: leadSources.id });
  if (row === undefined) throw new Error('the insert returned no row');
  return row;
}

/** PUT /crm/lead-sources/:id (leads:setup): renamed, switched off or on, or ignored. Ignoring isn't retroactive. */
export async function changeLeadSource(ctx: Ctx, { id, ...set }: In<typeof updateLeadSource>): Promise<Out<typeof updateLeadSource>> {
  const [row] = await crmTx(ctx).update(leadSources).set(set).where(eq(leadSources.id, id)).returning({ id: leadSources.id });
  if (row === undefined) throw new AppError('not_found', 'There is no such source');
  return {};
}

/** GET /crm/set-aside (leads:setup): newest first, each phone masked to its last 4 for every viewer, as lead lists are. */
export async function setAsidePage(ctx: Ctx, input: In<typeof listSetAside>): Promise<Out<typeof listSetAside>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await crmTx(ctx).select({ id: leadSetAsides.id, sourceId: leadSetAsides.sourceId, campaignId: leadSetAsides.campaignId,
    phone: leadSetAsides.phone, name: leadSetAsides.name, message: leadSetAsides.message, receivedAt: leadSetAsides.receivedAt })
    .from(leadSetAsides).where(and(
      input.filter.sourceId === undefined ? undefined : eq(leadSetAsides.sourceId, input.filter.sourceId),
      after([leadSetAsides.receivedAt, leadSetAsides.id], key && [key.at, key.id], 'desc'),
    )).orderBy(desc(leadSetAsides.receivedAt), desc(leadSetAsides.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, phone: maskOf(r.phone, 'last4'), receivedAt: isoMoment(r.receivedAt) })),
    next: rows.length > input.limit && last ? encodeCursor({ at: last.receivedAt, id: last.id }) : null,
  };
}
