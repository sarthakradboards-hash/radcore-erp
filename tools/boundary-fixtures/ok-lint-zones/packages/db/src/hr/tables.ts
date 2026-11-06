import { pgSchema, pgTableCreator, text } from 'drizzle-orm/pg-core';
import { auditColumns, id } from '../columns.ts';
const hr = pgSchema('hr');
export const employees = hr.table('employees', { id: id(), name: text('name'), ...auditColumns });
const table = pgTableCreator((name) => `rc_${name}`);
export const leave = table('leave', { id: id(), ...auditColumns });
