import { sql } from 'drizzle-orm';
import * as radcore from '../src/columns.ts';
export const leak = radcore.view('x', {}).as(sql`select 1`);
