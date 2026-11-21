// The invoice screens' row types, read off lib-sales' contract (RAD-125).
import type { getInvoice, listInvoices } from '@radcore/lib-sales/contract';
import type { z } from 'zod';

export const INVOICE_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type InvoiceRow = z.output<typeof listInvoices.output>['items'][number];
export type Invoice = z.output<typeof getInvoice.output>;
