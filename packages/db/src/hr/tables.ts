// The hr module's tables (ADR-005, M2-14 / RAD-92): the employee master. SQL zone (ADR-002 §3): `sql` only in a
// generated column. Pay, salary history and bank details come with payroll (M6-03), not here.
import { sql } from 'drizzle-orm';
import { boolean, date, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';

/**
 * A person who works here: their code, name, contact details, designation and joining date. The phone (kept in E.164,
 * `+919876543210`) and the email are personal data: the contract marks them pii(), and the audit redacts them. Switched
 * off, never deleted (ADR-005 §3, D-12). The code is unique whatever its case or spacing (`code_key`).
 */
export const employees = radcoreTable('employees', {
  id: id(),
  code: boundedText({ max: 20 }).notNull(),
  name: boundedText({ max: 120 }).notNull(),
  phone: boundedText({ max: 16 }),
  email: boundedText({ max: 254 }),
  designation: boundedText({ max: 80 }),
  joinedOn: date({ mode: 'string' }),
  active: boolean().notNull().default(true),
  codeKey: text().notNull().generatedAlwaysAs(sql`upper(btrim(code))`),
}, (t) => [uniqueIndex('ux_employees_code_key').on(t.codeKey)]);
