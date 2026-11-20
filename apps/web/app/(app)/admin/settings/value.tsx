'use client';
// A setting's value or default as a person reads it, by what kind of setting it is (RAD-133 on RAD-132's contract).
// Money and percentages arrive as strings at their column's places, so they go through the shared display helpers.
import { formatMoney } from '@radcore/lib-common';
import { getPriceList } from '@radcore/lib-sales/contract';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../decimal.ts';
import type { Setting } from './types.ts';

/** A reference setting's record: a price list by its name (never its id); another kind says what it holds. */
function Reference({ record, id }: { record: string; id: string }) {
  const list = useApiQuery(getPriceList, { id }, { enabled: record === 'price_list' });
  if (record !== 'price_list') return t('admin.settings.record', { id });
  return list.data?.name ?? t('loading');
}

export function SettingValue({ input, value }: { input: Setting['input']; value: unknown }) {
  if (value === null || value === undefined) return t('admin.settings.none');
  switch (input.kind) {
    case 'money': return typeof value === 'string' ? formatMoney(value) : String(value);
    case 'percent': return typeof value === 'string' ? `${asWritten(value)}%` : String(value);
    case 'yes_no': return t(value === true ? 'admin.settings.yes' : 'admin.settings.no');
    case 'choice': return input.choices.find((c) => c.value === value)?.label ?? String(value);
    case 'reference': return typeof value === 'string' ? <Reference record={input.record} id={value} /> : String(value);
    default: return String(value);
  }
}
