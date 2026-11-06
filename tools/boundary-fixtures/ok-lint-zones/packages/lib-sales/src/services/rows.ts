import type { Invoice, invoices } from '../../../db/src/sales/index.ts';
export async function getInvoice(input: Pick<typeof invoices.$inferSelect, 'id'>): Promise<typeof invoices.$inferSelect> {
  return { id: input.id, total: '0' };
}
export const listRows = async (): Promise<Invoice[]> => [];
