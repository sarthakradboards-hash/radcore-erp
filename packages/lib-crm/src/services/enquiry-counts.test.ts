// E7's exemption for enquiry-counts.ts (the architect on RAD-110, ADR-001 §6a): the file reads past the record scope,
// so it answers only counts keyed by campaign and source ids, never a lead's or an enquiry's row, id or field. The
// types are checked when the tests are typechecked; a field added to the answer fails.
import { expectTypeOf, it } from 'vitest';
import type { enquiryCounts } from './enquiry-counts.ts';

it('answers only counts, keyed by campaign and source', () => {
  expectTypeOf<Awaited<ReturnType<typeof enquiryCounts>>>().toEqualTypeOf<{ byCampaign: Map<string, number>; bySource: Map<string, number> }>();
});
