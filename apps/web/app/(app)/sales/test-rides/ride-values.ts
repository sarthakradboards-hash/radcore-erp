// A test ride as its form holds it (RAD-127): the lead, the demo unit, and when, as India wall time (a date-and-time field's
// value), which goes to the contract as the moment in UTC. The checks are the contract's own.
import { indiaTimeToMoment } from '@radcore/lib-common';
import { scheduleTestRide } from '@radcore/lib-sales/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = scheduleTestRide.input.shape;

/** "2026-11-07T15:30" to its UTC moment; anything else is not a time. */
const atMoment = z.string().transform((s, ctx) => {
  try { return indiaTimeToMoment(s); } catch {
    ctx.addIssue({ code: 'custom', message: t('sales.ride.err.when') });
    return z.NEVER;
  }
}).pipe(shape.scheduledAt);

export const rideSchema = z.object({
  leadId: z.string().min(1, t('sales.ride.form.lead.none')).pipe(shape.leadId),
  itemId: z.string().min(1, t('sales.ride.form.item.none')).pipe(shape.itemId),
  serialNo: shape.serialNo,
  scheduledAt: atMoment,
  note: z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(shape.note),
});
export type RideInput = z.input<typeof rideSchema>;
export type RideValues = z.output<typeof rideSchema>;

export const NEW_RIDE: RideInput = { leadId: '', itemId: '', serialNo: '', scheduledAt: '', note: '' };
