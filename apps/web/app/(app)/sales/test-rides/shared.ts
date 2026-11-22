// The test ride screens' row type, read off lib-sales' contract (RAD-127), and the refusals in a ride's own words.
import { TEST_RIDE_OUTCOMES, type listTestRides } from '@radcore/lib-sales/contract';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { SALES_MESSAGES } from '../shared.tsx';

export const OUTCOMES = TEST_RIDE_OUTCOMES;
export type RideRow = z.output<typeof listTestRides.output>['items'][number];

/** A ride's refusals: the shared words, with `wrong_status` said for a ride (an outcome is recorded once, and before its time
 * only "called off" is allowed) and `not_demo`. */
export const RIDE_MESSAGES: Partial<Record<string, string>> = {
  ...SALES_MESSAGES, not_demo: t('sales.err.not_demo'), wrong_status: t('sales.ride.err.wrong_status'),
};
