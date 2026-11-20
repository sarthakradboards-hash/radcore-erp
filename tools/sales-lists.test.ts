// RAD-112 (ADR-005 §4, ADR-007 §1): the quotes' and orders' status CHECKs list exactly lib-common's lists. L1 lets a
// CHECK hold only a plain `sql`, so tables.ts writes the codes out; this keeps each pair one list.
import { SALES_ORDER_STATUSES, SALES_QUOTE_STATUSES } from '@radcore/lib-common';
import { PgDialect, getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { salesOrders, salesQuotes } from '../packages/db/src/sales/tables.ts';

const codesIn = (table: PgTable, name: string) => {
  const check = getTableConfig(table).checks.find((c) => c.name === name);
  const text = check === undefined ? '' : new PgDialect().sqlToQuery(check.value).sql;
  return [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

it("holds the quotes' and orders' status CHECKs to lib-common's lists, in order", () => {
  expect(codesIn(salesQuotes, 'ck_sales_quotes_status')).toEqual(SALES_QUOTE_STATUSES);
  expect(codesIn(salesOrders, 'ck_sales_orders_status')).toEqual(SALES_ORDER_STATUSES);
});
