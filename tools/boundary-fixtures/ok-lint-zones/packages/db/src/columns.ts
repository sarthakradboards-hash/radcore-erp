import { uuid } from 'drizzle-orm/pg-core';
export const id = () => uuid('id').primaryKey();
export type Id = string;
