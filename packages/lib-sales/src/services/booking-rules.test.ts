// RAD-117: a booking holds only a unit a delivery would take, damaged ones only where stock.sell_damaged_units is on.
import { describe, expect, it } from 'vitest';
import { bookable } from './booking-rules.ts';

const unit = (o: Partial<{ ownership: string; condition: string; locationId: string | null }> = {}) =>
  ({ ownership: 'ours', condition: 'new', locationId: 'store', ...o });

describe('a bookable unit', () => {
  it('is ours, at a place, new or used', () => {
    expect([bookable(unit(), false), bookable(unit({ condition: 'used' }), false)]).toEqual([true, true]);
    expect([bookable(unit({ ownership: 'customer' }), false), bookable(unit({ ownership: 'gone' }), true),
      bookable(unit({ locationId: null }), true)]).toEqual([false, false, false]);
  });

  it('is damaged only where the setting is on, and never demo', () => {
    expect([bookable(unit({ condition: 'damaged' }), false), bookable(unit({ condition: 'damaged' }), true)]).toEqual([false, true]);
    expect([bookable(unit({ condition: 'demo' }), false), bookable(unit({ condition: 'demo' }), true)]).toEqual([false, false]);
  });
});
