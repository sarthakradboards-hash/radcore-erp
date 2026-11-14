// The hr module's contracts (ADR-001 §6, §7a). Like every contract file it imports only zod and lib-common (D5), so the
// browser can load it. RAD-92 (M2-14): the basic employee master. An employee is switched off, never deleted (ADR-005
// §3, D-12). The phone and email are personal data: masked for a principal without pii:read, and each record shown
// unmasked is logged as a look at that employee (ADR-005 §7c, RAD-40). Pay comes with payroll (M6-03).
import {
  dateString, defineContract, emailString, idString, listInput, listOf, phoneString, pii, piiRecord, searchText,
} from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** A short code people type and print: letters, digits and `-`, kept as typed, unique whatever its case. */
const employeeCode = () => z.string().trim().min(1, 'Enter a code').max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use letters, digits and -');
const employeeName = () => z.string().trim().min(1, 'Enter a name').max(120);
const designation = () => z.string().trim().max(80);
const status = z.enum(['active', 'inactive']);

/** An employee as a screen sees one. */
export const employee = piiRecord('employees', z.object({
  id: idString(), code: z.string(), name: z.string(),
  phone: pii(z.string().nullable(), 'last4'), email: pii(z.string().nullable()),
  designation: z.string().nullable(), joinedOn: z.string().nullable(), active: z.boolean(),
}));

/** Employees a page at a time, by code: searched by code or name, filtered by active or switched off. */
export const listEmployees = defineContract({
  method: 'GET', path: '/hr/employees', auth: 'session', perm: 'employees:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), status: status.optional() })),
  output: listOf(employee),
});

/** A new employee. code_taken: another has this code, whatever its case or spacing. */
export const addEmployee = defineContract({
  method: 'POST', path: '/hr/employees', auth: 'session', perm: 'employees:write', tx: write,
  input: z.object({ code: employeeCode(), name: employeeName(), phone: phoneString().optional(),
    email: emailString().optional(), designation: designation().optional(), joinedOn: dateString().optional() }),
  output: z.object({ id: idString() }), errors: ['code_taken'],
});

/** An employee's details changed, or switched off or on. A field left out is kept; `null` clears an optional one. A
 * screen that shows a masked value leaves it out, so it never saves the mask (ADR-001 §7a). */
export const updateEmployee = defineContract({
  method: 'PATCH', path: '/hr/employees/:id', auth: 'session', perm: 'employees:write', tx: write,
  input: z.object({ id: idString(), code: employeeCode().optional(), name: employeeName().optional(),
    phone: phoneString().nullable().optional(), email: emailString().nullable().optional(),
    designation: designation().nullable().optional(), joinedOn: dateString().nullable().optional(),
    active: z.boolean().optional() }),
  output: z.object({}), errors: ['code_taken'],
});
