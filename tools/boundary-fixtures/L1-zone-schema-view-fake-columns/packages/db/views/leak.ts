import { sql } from 'drizzle-orm';
import { radcore } from './columns.ts';
export const leak = radcore.view('x', {}).as(sql`select 1`);
