// The booking screens' row types, read off lib-sales' contract (RAD-127), and the refusals in a booking's own words.
import type { listBookings } from '@radcore/lib-sales/contract';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { SALES_MESSAGES } from '../shared.tsx';

export const BOOKING_STATUSES = ['booked', 'delivered', 'cancelled'] as const;
export type BookingRow = z.output<typeof listBookings.output>['items'][number];

/** A booking's refusals: the shared words, with the ones that read as another document's (a unit held "for another order", an
 * account of "this invoice", a date before a source) said for a booking, and the booking's own. */
export const BOOKING_MESSAGES: Partial<Record<string, string>> = {
  ...SALES_MESSAGES,
  ...Object.fromEntries(['booking_one_unit', 'unit_unavailable', 'line_booked', 'advance_required', 'series_full', 'wrong_file_kind', 'not_ready', 'upload_refused']
    .map((c) => [c, t(`sales.err.${c as 'line_booked'}`)])),
  unit_held: t('sales.booking.err.unit_held'),
  forbidden: t('sales.booking.err.forbidden'),
  wrong_status: t('sales.booking.err.wrong_status'),
  exceeds_receipt: t('sales.booking.err.exceeds_receipt'),
  place_not_sellable: t('sales.booking.err.place_not_sellable'),
  account_inactive: t('sales.booking.err.account_inactive'),
  date_before_source: t('sales.booking.err.date_before_source'),
};
