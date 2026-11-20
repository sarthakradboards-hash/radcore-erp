// The settings and number-series screens' services (RAD-132, ADR-001 §8c). apps/api composes every library's settings
// and series and hands them in, as it composes routes, since lib-platform imports no module. A change applies from the
// next request (a Ctx reads settings once); the handler keeps its reason, and the tables' audit triggers the old and new.
import { numberCounters, platformTx, seriesPrefixes, settings } from '@radcore/db/platform';
import { financialYear, indiaDate } from '@radcore/lib-common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { listNumberSeries, listSettings, setSeriesPrefix, setSetting } from './contract/settings.ts';
import type { Ctx } from './ctx.ts';
import { AppError } from './errors.ts';
import { formatNumber, type Series } from './numbering.ts';
import { principalsOf } from './principals.ts';
import { storeSetting } from './settings-store.ts';
import type { SettingDef } from './settings.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const json = z.json();
const today = () => indiaDate(new Date());
const nextYear = (start: string) => financialYear(`${Number(start.slice(0, 4)) + 1}-04-01`);

/** GET /settings: each setting with its value now, its default and its last change. */
export async function listSettingsOf(ctx: Ctx, catalogue: readonly SettingDef<unknown>[]): Promise<Out<typeof listSettings>> {
  const rows = await platformTx(ctx).select({ key: settings.key, at: settings.updatedAt, by: settings.updatedBy }).from(settings);
  const stored = new Map(rows.map((r) => [r.key, r]));
  const who = await principalsOf(ctx, rows.map((r) => r.by));
  return { settings: catalogue.map((d) => {
    const row = stored.get(d.key);
    return { key: d.key, label: d.label, description: d.description, input: d.input, value: json.parse(ctx.settings.get(d)),
      default: json.parse(d.fallback), changed: row !== undefined, changedAt: row?.at.toISOString() ?? null,
      changedBy: row === undefined ? null : who(row.by), changedWith: 'settings:write' as const };
  }) };
}

/** PUT /settings/:key: the value its schema and its own check accept, or null for its default. */
export async function changeSetting(ctx: Ctx, catalogue: readonly SettingDef<unknown>[], input: In<typeof setSetting>):
  Promise<Out<typeof setSetting>> {
  const def = catalogue.find((d) => d.key === input.key);
  if (def === undefined) throw new AppError('not_found', 'There’s no such setting');
  if (input.value === null) {
    await storeSetting(ctx, def.key, null);
    return {};
  }
  const parsed = def.schema.safeParse(input.value);
  if (!parsed.success) {
    throw new AppError('invalid_value', 'This setting doesn’t take that value', parsed.error.issues.map((i) =>
      ({ path: ['value', ...i.path.filter((p) => typeof p !== 'symbol')], code: i.code, message: i.message })));
  }
  const refusal = def.check === undefined ? null : await def.check(ctx, parsed.data);
  if (refusal !== null) throw new AppError('value_refused', refusal, [{ path: ['value'], code: 'refused', message: refusal }]);
  await storeSetting(ctx, def.key, parsed.data);
  return {};
}

/** GET /number-series: each series' prefix this year and next, and the number it would draw next. */
export async function listSeriesOf(ctx: Ctx, catalogue: readonly Series[]): Promise<Out<typeof listNumberSeries>> {
  const tx = platformTx(ctx);
  const year = financialYear(today());
  const next = nextYear(year.start);
  const keys = catalogue.map((s) => s.key);
  const counters = keys.length === 0 ? [] : await tx.select().from(numberCounters)
    .where(and(inArray(numberCounters.series, keys), inArray(numberCounters.financialYear, [year.label, next.label])));
  const history = keys.length === 0 ? [] : await tx.select().from(seriesPrefixes).where(inArray(seriesPrefixes.series, keys));
  // What a year's first number would take: the latest change on or before it, else the declared prefix.
  const drawn = (s: Series, label: string) => history.filter((h) => h.series === s.key && h.fromYear <= label)
    .toSorted((a, b) => b.fromYear.localeCompare(a.fromYear))[0]?.prefix ?? s.prefix;
  const counter = (s: Series, label: string) => counters.find((c) => c.series === s.key && c.financialYear === label);
  return { series: catalogue.map((s) => {
    const now = counter(s, year.label);
    const prefixThisYear = now?.prefix ?? drawn(s, year.label);
    return { key: s.key, label: s.label, prefixThisYear, prefixNextYear: counter(s, next.label)?.prefix ?? drawn(s, next.label),
      next: formatNumber(s, prefixThisYear, year.label, (now?.last ?? 0) + 1) };
  }) };
}

/**
 * PUT /number-series/:key/prefix: from next year, always; from this year only while it has drawn no number. This year's
 * counter row is made ahead if it's absent (no number drawn, `last` 0) and locked, so this and the year's first number
 * take turns, then given the prefix (ADR-001 §8c, ADR-006 §3).
 */
export async function changeSeriesPrefix(ctx: Ctx, catalogue: readonly Series[], input: In<typeof setSeriesPrefix>):
  Promise<Out<typeof setSeriesPrefix>> {
  const s = catalogue.find((c) => c.key === input.key);
  if (s === undefined) throw new AppError('not_found', 'There’s no such number series');
  const tx = platformTx(ctx);
  const year = financialYear(today());
  const fromYear = input.from === 'next_year' ? nextYear(year.start).label : year.label;
  if (input.from === 'this_year') {
    const here = and(eq(numberCounters.series, s.key), eq(numberCounters.financialYear, year.label));
    await tx.insert(numberCounters).values({ series: s.key, financialYear: year.label, prefix: input.prefix, last: 0 }).onConflictDoNothing();
    const [counter] = await tx.select().from(numberCounters).where(here).for('update');
    if ((counter?.last ?? 0) > 0) {
      throw new AppError('series_in_use', 'This year already has numbers: change the prefix from next year');
    }
    if (counter !== undefined && counter.prefix !== input.prefix) await tx.update(numberCounters).set({ prefix: input.prefix }).where(here);
  }
  await tx.insert(seriesPrefixes).values({ series: s.key, fromYear, prefix: input.prefix })
    .onConflictDoUpdate({ target: [seriesPrefixes.series, seriesPrefixes.fromYear], set: { prefix: input.prefix } });
  return { fromYear };
}
