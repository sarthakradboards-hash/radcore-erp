// auditor-2 on #230: an items:write person without cost:read must never send a purchase price. A null price comes back
// unmasked for everyone, so the choice can't rest on the mask alone, and a default is sent even with no box on screen.
import { describe, expect, it } from 'vitest';
import { costField } from './cost-field.ts';

const masked = { masked: '••••••' };

describe('the purchase-price field', () => {
  it('without cost:read, a new item has no price field and nothing to send', () => {
    expect(costField(false, undefined)).toEqual({ cost: 'none', defaults: {} });
  });

  it('without cost:read, an item with no price has no field and sends nothing (null comes back unmasked)', () => {
    expect(costField(false, null)).toEqual({ cost: 'none', defaults: {} });
  });

  it('without cost:read, a masked price shows read-only and carries only the mask, which the form never sends', () => {
    expect(costField(false, masked)).toEqual({ cost: 'masked', defaults: { purchasePrice: masked } });
  });

  it('with cost:read, the price is a box: empty for a new item or no price, else the price', () => {
    expect(costField(true, undefined)).toEqual({ cost: 'edit', defaults: { purchasePrice: '' } });
    expect(costField(true, null)).toEqual({ cost: 'edit', defaults: { purchasePrice: '' } });
    expect(costField(true, '1850.500000')).toEqual({ cost: 'edit', defaults: { purchasePrice: '1850.50' } }); // paise kept, extra zeros gone (e2e on #230)
  });

  it('a mask wins over the key: the server decides who sees it', () => {
    expect(costField(true, masked).cost).toBe('masked');
  });
});
