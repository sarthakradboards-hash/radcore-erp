// RC-115 (M2-12): the newest rate in force wins over an older, longer HSN code; a longer code breaks a tie.
import { describe, expect, it } from 'vitest';
import { prefixesOf, rowInForce } from './rates.ts';

describe('which GST rate applies', () => {
  it('reads an item code as its chapter, heading, sub-heading and itself', () => {
    expect([prefixesOf('87116020'), prefixesOf('8507'), prefixesOf('850760')]).toEqual([
      ['87', '8711', '871160', '87116020'], ['85', '8507'], ['85', '8507', '850760']]);
  });

  it('lets a newer short code beat an older long one, and a longer code win a tie (RC-115)', () => {
    const old8 = { hsn: '87116020', effectiveFrom: '2017-07-01' };
    const new4 = { hsn: '8711', effectiveFrom: '2025-09-22' };
    const new6 = { hsn: '871160', effectiveFrom: '2025-09-22' };
    expect(rowInForce([old8, new4])).toBe(new4);
    expect(rowInForce([new4, old8])).toBe(new4);
    expect(rowInForce([new4, new6, old8])).toBe(new6);
    expect(rowInForce([])).toBeUndefined();
  });
});
