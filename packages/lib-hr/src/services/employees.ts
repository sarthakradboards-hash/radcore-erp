// The employee master (RAD-92, M2-14). Switched off, never deleted (ADR-005 §3, D-12). A phone is kept in E.164 and an
// email in lower case, so one number or address is one value. Two codes that differ only in case or spacing are one
// code: the database's unique `code_key` decides, and its refusal is answered as code_taken, so nothing here races.
// The handler masks phone and email for a principal without pii:read and logs each look (the contract's pii()).
import { after, employees, hrTx, searchWords } from '@radcore/db/hr';
import { normaliseEmail, normalisePhone } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, sortedCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { addEmployee, listEmployees, updateEmployee } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const CODE_SORT = { column: 'code', desc: false } as const;

// ux_employees_code_key's refusal, as code_taken; anything else is thrown as it is.
async function sameCodeRefused<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (e) {
    if ((e as { cause?: { constraint?: string } }).cause?.constraint === 'ux_employees_code_key') {
      throw new AppError('code_taken', 'Another employee already has this code',
        [{ path: ['code'], code: 'taken', message: 'Choose another code' }]);
    }
    throw e;
  }
}
// The contract's phoneString checked it parses, so a number that doesn't is a contract change, not input.
const phoneOf = (p: string) => {
  const e164 = normalisePhone(p);
  if (e164 === undefined) throw new Error('phoneString let through a number normalisePhone refuses');
  return e164;
};
// A field left out is kept; null clears it; a value is stored as the master keeps it.
const kept = <T, R>(v: T | null | undefined, as: (x: T) => R) => (v === undefined ? {} : { value: v === null ? null : as(v) });

/** GET /hr/employees (employees:read): by code, a page at a time; a page key is the code's key and the id. */
export async function listPeople(ctx: Ctx, input: In<typeof listEmployees>): Promise<Out<typeof listEmployees>> {
  const key = input.after === undefined ? undefined : decodeCursor(sortedCursor(CODE_SORT, z.string().max(20)), input.after);
  const { search, status } = input.filter;
  const rows = await hrTx(ctx).select({ id: employees.id, code: employees.code, name: employees.name, phone: employees.phone,
    email: employees.email, designation: employees.designation, joinedOn: employees.joinedOn, active: employees.active,
    codeKey: employees.codeKey }).from(employees)
    .where(and(
      searchWords([employees.code, employees.name], search),
      status === undefined ? undefined : eq(employees.active, status === 'active'),
      after([employees.codeKey, employees.id], key && [key.value, key.id], 'asc'),
    ))
    .orderBy(asc(employees.codeKey), asc(employees.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, code: r.code, name: r.name, phone: r.phone, email: r.email,
      designation: r.designation, joinedOn: r.joinedOn, active: r.active })),
    next: rows.length > input.limit && last ? encodeCursor({ ...CODE_SORT, value: last.codeKey, id: last.id }) : null,
  };
}

/** POST /hr/employees (employees:write). */
export async function addPerson(ctx: Ctx, input: In<typeof addEmployee>): Promise<Out<typeof addEmployee>> {
  const [row] = await sameCodeRefused(hrTx(ctx).insert(employees).values({
    code: input.code, name: input.name, designation: input.designation || null, joinedOn: input.joinedOn ?? null,
    phone: input.phone === undefined ? null : phoneOf(input.phone),
    email: input.email === undefined ? null : normaliseEmail(input.email),
  }).returning({ id: employees.id }));
  if (row === undefined) throw new Error('the insert returned no row');
  return { id: row.id };
}

/** PATCH /hr/employees/:id (employees:write). */
export async function updatePerson(ctx: Ctx, input: In<typeof updateEmployee>): Promise<Out<typeof updateEmployee>> {
  const fields = { code: kept(input.code, String), name: kept(input.name, String), phone: kept(input.phone, phoneOf),
    email: kept(input.email, normaliseEmail), designation: kept(input.designation, (d) => d || null),
    joinedOn: kept(input.joinedOn, String), active: kept(input.active, Boolean) };
  const changes = Object.fromEntries(Object.entries(fields).flatMap(([k, f]) => ('value' in f ? [[k, f.value]] : [])));
  const tx = hrTx(ctx);
  const found = Object.keys(changes).length === 0
    ? await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.id))
    : await sameCodeRefused(tx.update(employees).set(changes).where(eq(employees.id, input.id)).returning({ id: employees.id }));
  if (found.length === 0) throw new AppError('not_found', 'There is no such employee');
  return {};
}
