import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/schemas.ts';
const v = radcore.view('v', { a: text('a') }).as(sql`select a from t`);
export type V = typeof v;
