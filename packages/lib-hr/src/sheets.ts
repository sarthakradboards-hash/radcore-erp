// lib-hr's sheet of the masters workbook (RAD-92): employees, read as the employee list reads them, a page at a time.
// The worker's job file joins it with the other modules' sheets (ADR-001 §8b). It goes in only for a starter holding
// employees:read when the job runs; the phone and email are masked as on the screen, unmasked with pii:read only.
import type { ExportRow, ExportSheet } from '@radcore/lib-platform';
import { listPeople } from './services/employees.ts';

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
// The service's answer type allows a mask, which only the handler makes; a row here holds the value, masked by the engine.
const text = (v: string | { masked: string } | null) => (v === null || typeof v === 'string' ? v : v.masked);

const employees: ExportSheet = {
  name: 'Employees', perm: 'employees:read',
  columns: ['code', 'name', 'phone', 'email', 'designation', 'joinedOn', 'active'],
  pii: { phone: 'last4', email: 'whole' },
  rows: async (ctx, _filter, page) => {
    const { items, next } = await listPeople(ctx, { filter: {}, ...page });
    return {
      items: items.map((e): ExportRow => ({ code: e.code, name: e.name, phone: text(e.phone), email: text(e.email),
        designation: e.designation, joinedOn: e.joinedOn, active: yesNo(e.active) })),
      next,
    };
  },
};

/** lib-hr's sheets, in the workbook's order. */
export const hrSheets: readonly ExportSheet[] = Object.freeze([employees]);
