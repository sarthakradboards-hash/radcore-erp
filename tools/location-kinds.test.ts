// RAD-92 (ADR-005 §4): a location's kind CHECK lists exactly lib-common's LOCATION_KINDS. L1 lets the CHECK hold only a
// plain `sql`, so its codes are written out in tables.ts; this keeps the two lists one list.
import { LOCATION_KIND_CODES } from '@radcore/lib-common';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { locations } from '../packages/db/src/stock/tables.ts';

it("holds the locations kind CHECK to lib-common's LOCATION_KINDS, in order", () => {
  const check = getTableConfig(locations).checks.find((c) => c.name === 'ck_locations_kind');
  const text = check === undefined ? '' : new PgDialect().sqlToQuery(check.value).sql;
  expect([...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(LOCATION_KIND_CODES);
});
