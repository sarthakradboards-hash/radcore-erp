import { pgTable, text } from 'drizzle-orm/pg-core';
import { auditColumns } from '../columns.ts';
export const withAudit = <T extends object>(cols: T) => ({ ...cols, ...auditColumns });
export const tasks = pgTable('tasks', withAudit({ title: text('title') })) satisfies object;
export const taskStatuses = ['open', 'done'] as const;
