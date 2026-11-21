// E7's exemption for delivered.ts (the architect on RAD-112, ADR-001 §6a): the file reads past the record scope, so each
// export answers only aggregates (Money, Quantity, boolean) keyed by what its caller passed in, never another
// document's row, id or field. The types are checked when the tests are typechecked; a field added to any answer fails.
import type { Money, Quantity } from '@radcore/lib-common';
import { expectTypeOf, it } from 'vitest';
import type { Credited, creditedOf, deliveredNotInvoiced, hasCreditNotes, hasDeliveries, holdDeliveriesOf, netDelivered, orderDelivered, Returned, returnedOf } from './delivered.ts';

type Answer<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

it('answers only aggregates, keyed by the caller’s own ids', () => {
  expectTypeOf<Answer<typeof netDelivered>>().toEqualTypeOf<Map<string, Quantity>>();
  expectTypeOf<Answer<typeof orderDelivered>>().toEqualTypeOf<{ any: boolean; all: boolean }>();
  expectTypeOf<Answer<typeof hasDeliveries>>().toEqualTypeOf<boolean>();
  expectTypeOf<Answer<typeof deliveredNotInvoiced>>().toEqualTypeOf<Money>();
  expectTypeOf<Answer<typeof holdDeliveriesOf>>().toEqualTypeOf<void>();
  expectTypeOf<Answer<typeof returnedOf>>().toEqualTypeOf<Map<string, Returned>>();
  expectTypeOf<Answer<typeof creditedOf>>().toEqualTypeOf<Map<string, Credited>>();
  expectTypeOf<Credited>().toEqualTypeOf<{ qty: Quantity; taxable: Money; cgst: Money; sgst: Money; igst: Money; cost: Money }>();
  expectTypeOf<Answer<typeof hasCreditNotes>>().toEqualTypeOf<boolean>();
  expectTypeOf<Returned>().toEqualTypeOf<{ qty: Quantity; value: Money; taxable: Money; gst: Money;
    batches: ReadonlyMap<string, Quantity>; serials: ReadonlyMap<string, boolean> }>();
});
