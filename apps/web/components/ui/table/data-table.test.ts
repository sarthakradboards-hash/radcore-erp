// A list contract's sortInput is the table's sort (typecheck runs the type checks), and a column the contract can't
// sort can't be marked sortable.
import { defineContract, listInput, listOf, sortInput } from '@radcore/lib-common';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { Column, Sort, SortOf } from './data-table.tsx';

const listParties = defineContract({
  method: 'GET', path: '/parties', auth: 'session', perm: 'parties:read', tx: { readOnly: true, isolation: 'read committed' },
  input: listInput(z.object({}), sortInput(['name', 'city'])),
  output: listOf(z.object({ name: z.string(), phone: z.string() })),
});
type Party = { name: string; phone: string };
type By = SortOf<typeof listParties>['column'];
type Cell = Column<Party, By>['cell'];

describe('DataTable sort', () => {
  it("is the list contract's sortInput", () => {
    expectTypeOf<SortOf<typeof listParties>>().toEqualTypeOf<Sort<'name' | 'city'>>();
    expectTypeOf<{ id: 'name'; header: string; cell: Cell; sortable: true }>().toExtend<Column<Party, By>>();
    expectTypeOf<{ id: 'phone'; header: string; cell: Cell }>().toExtend<Column<Party, By>>();
    // The contract can't sort by phone, so a column can't say it can.
    expectTypeOf<{ id: 'phone'; header: string; cell: Cell; sortable: true }>().not.toExtend<Column<Party, By>>();
  });

  it('is refused for a column the contract does not sort by', () => {
    const asked = (column: string) => listParties.input.safeParse({ filter: {}, limit: 50, sort: { column, desc: false } }).success;
    expect(asked('name')).toBe(true);
    expect(asked('phone')).toBe(false);
  });
});
