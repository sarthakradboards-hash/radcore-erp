// RAD-94 (ADR-005 §4, ADR-006 §5): the units tables' CHECKs list exactly lib-common's lists. L1 lets a CHECK hold only a
// plain `sql`, so tables.ts writes the codes out; this keeps each pair one list, the movements each kind rides on too.
import { UNIT_CONDITIONS, UNIT_EVENTS, UNIT_EVENT_KINDS, UNIT_OWNERSHIPS } from '@radcore/lib-common';
import { PgDialect, getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { unitEvents, units } from '../packages/db/src/stock/tables.ts';

const checkText = (table: PgTable, name: string) => {
  const check = getTableConfig(table).checks.find((c) => c.name === name);
  return check === undefined ? '' : new PgDialect().sqlToQuery(check.value).sql;
};
const codesIn = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

it("holds the units' ownership and condition CHECKs to lib-common's lists, in order", () => {
  expect(codesIn(checkText(units, 'ck_units_ownership'))).toEqual(UNIT_OWNERSHIPS);
  expect(codesIn(checkText(units, 'ck_units_condition'))).toEqual(UNIT_CONDITIONS);
  expect(codesIn(checkText(unitEvents, 'ck_unit_events_condition'))).toEqual(UNIT_CONDITIONS);
});

it("holds the unit events' kinds and the movements each rides on to lib-common's UNIT_EVENTS", () => {
  expect(codesIn(checkText(unitEvents, 'ck_unit_events_kind'))).toEqual(UNIT_EVENT_KINDS);
  // Each `when` branch of the movements CHECK, in order: both, in only, out only; the rest ride on neither.
  const branches = checkText(unitEvents, 'ck_unit_events_movements').split('when').slice(1).map((b) => codesIn(b.split('then')[0] ?? ''));
  const moving = (m: string) => UNIT_EVENT_KINDS.filter((k) => UNIT_EVENTS[k].movements === m);
  expect(branches).toEqual([moving('both'), moving('in'), moving('out')]);
});
