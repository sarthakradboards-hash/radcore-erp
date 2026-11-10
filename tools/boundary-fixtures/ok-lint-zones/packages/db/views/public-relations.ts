import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';
export const vPublic = radcore.view('v_public', { a: text('a') }).as(sql`select a from t`);
