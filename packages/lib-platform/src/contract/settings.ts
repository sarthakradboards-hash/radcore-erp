// The settings and number-series prefixes routes (RAD-132, ADR-001 §8c), for ui-2's screens (M3-27). Every setting a
// library declares, with its label, description, value and default, under settings:read; a change under settings:write
// with a reason. A series' prefix changes from the next financial year, or this one before its first number.
import { dateString, defineContract, momentString, principalOut, reason } from '@radcore/lib-common';
import { z } from 'zod';

const write = { readOnly: false, isolation: 'read committed' } as const;
const read = { readOnly: true, isolation: 'read committed' } as const;
const settingKey = () => z.string().regex(/^[a-z]+\.[a-z][a-z0-9_]*$/, 'Not a setting key');
const seriesKey = () => z.string().regex(/^[a-z]+\.[a-z][a-z0-9_]*$/, 'Not a number series');

/** What the screen offers for a setting: a field of its kind, a choice of fixed values, or one record of a kind. */
const settingInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['money', 'percent', 'integer', 'text', 'yes_no']) }),
  z.object({ kind: z.literal('choice'), choices: z.array(z.object({ value: z.string(), label: z.string() }).readonly()).readonly() }),
  z.object({ kind: z.literal('reference'), record: z.string() }),
]);

/** GET /settings (settings:read): every setting, its value now and its default, and its last change. */
export const listSettings = defineContract({
  method: 'GET', path: '/settings', auth: 'session', perm: 'settings:read', tx: read, input: z.object({}),
  output: z.object({ settings: z.array(z.object({
    key: settingKey(), label: z.string(), description: z.string(), input: settingInput,
    value: z.json(), default: z.json(),
    changed: z.boolean(), // false when the default is in force: nothing is stored
    changedAt: momentString().nullable(), changedBy: principalOut.nullable(),
    changedWith: z.literal('settings:write'), // the key a change needs
  })) }),
});

/** PUT /settings/:key (settings:write): a new value, checked by the setting's schema and its own check, or null to put
 * its default back. It applies from the next request; what a posted document decided stays as it was. */
export const setSetting = defineContract({
  method: 'PUT', path: '/settings/:key', auth: 'session', perm: 'settings:write', tx: write,
  input: z.object({ key: settingKey(), value: z.json().nullable(), reason: reason() }),
  output: z.object({}),
  errors: ['invalid_value', 'value_refused'],
});

const year = z.object({ label: z.string(), start: dateString() });

/** GET /number-series (settings:read): this financial year and next, and each series' prefix this year (its
 * counter's, else what it would draw), next year's, the number it would draw next (for show: nothing is locked), and
 * whether this year has drawn one, after which a prefix changes only from next year. */
export const listNumberSeries = defineContract({
  method: 'GET', path: '/number-series', auth: 'session', perm: 'settings:read', tx: read, input: z.object({}),
  output: z.object({ thisYear: year, nextYear: year, series: z.array(z.object({
    key: seriesKey(), label: z.string(), prefixThisYear: z.string(), prefixNextYear: z.string(), next: z.string(),
    thisYearDrawn: z.boolean(),
  })) }),
});

/** PUT /number-series/:key/prefix (settings:write): a new prefix from next year, or from this year while it has drawn no
 * number (`series_in_use` once it has). An issued number never changes. */
export const setSeriesPrefix = defineContract({
  method: 'PUT', path: '/number-series/:key/prefix', auth: 'session', perm: 'settings:write', tx: write,
  input: z.object({
    key: seriesKey(),
    prefix: z.string().regex(/^[A-Z0-9]{1,4}$/, 'Use 1 to 4 capital letters or digits'),
    from: z.enum(['this_year', 'next_year']),
    reason: reason(),
  }),
  output: z.object({ fromYear: z.string() }),
  errors: ['series_in_use'],
});
