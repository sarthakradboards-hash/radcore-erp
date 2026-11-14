import { pgTable, text } from 'drizzle-orm/pg-core';
export const leads = pgTable('leads', { id: text('id').primaryKey(), createdBy: text('created_by') });
