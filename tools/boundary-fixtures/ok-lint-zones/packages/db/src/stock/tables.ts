import { sql } from 'drizzle-orm';
import { check, numeric, pgTable } from 'drizzle-orm/pg-core';
const cap = 290;
export const rates = pgTable('rates', { rate: numeric({ precision: 9, scale: 6 }) },
  (t) => [check('ck_rates_rate', sql`${t.rate} between 0 and ${cap}`.inlineParams())]);
