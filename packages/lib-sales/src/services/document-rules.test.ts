// RAD-112 (ADR-007 §1, §4; RC-111): quotes' and orders' moves and the bounds on their dates, without a database. Each
// refusal pins its code and message, since a changed message is a change no other test would notice.
import { AppError } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';
import { overDiscount } from './checks-rules.ts';
import { checkDate, lineValues, listRateBeforeTax, mayEdit, mayMove, netRate, ORDER_MOVES, QUOTE_MOVES, shareOf } from './document-rules.ts';

const outcome = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message}${e.issues.map((i) => ` / ${i.path.join('.')} ${i.code} ${i.message}`).join('')}`;
    throw e;
  }
};

describe('mayMove', () => {
  it('lets a quote go draft → sent → accepted, declined or expired, and nowhere else', () => {
    expect(QUOTE_MOVES).toEqual({ draft: ['sent'], sent: ['accepted', 'declined', 'expired'], accepted: [], declined: [], expired: [] });
    expect(outcome(() => mayMove('quote', 'draft', 'sent'))).toBe('ok');
    expect(outcome(() => mayMove('quote', 'sent', 'expired'))).toBe('ok');
    expect(outcome(() => mayMove('quote', 'draft', 'accepted'))).toBe('wrong_status: This quote is draft, so it can’t be accepted');
    expect(outcome(() => mayMove('quote', 'accepted', 'sent'))).toBe('wrong_status: This quote is accepted, so it can’t be sent');
  });
  it('lets an order go draft → confirmed → closed or cancelled, and nowhere else', () => {
    expect(ORDER_MOVES).toEqual({ draft: ['confirmed'], confirmed: ['closed', 'cancelled'], closed: [], cancelled: [] });
    expect(outcome(() => mayMove('order', 'confirmed', 'cancelled'))).toBe('ok');
    expect(outcome(() => mayMove('order', 'draft', 'closed'))).toBe('wrong_status: This order is draft, so it can’t be closed');
    expect(outcome(() => mayMove('order', 'unknown', 'confirmed'))).toBe('wrong_status: This order is unknown, so it can’t be confirmed');
  });
});

describe('mayEdit', () => {
  it('changes a draft only, and a confirmed order when that is allowed', () => {
    expect(outcome(() => mayEdit('quote', 'draft'))).toBe('ok');
    expect(outcome(() => mayEdit('quote', 'sent'))).toBe('wrong_status: This quote is sent, so it can’t be changed');
    expect(outcome(() => mayEdit('order', 'confirmed'))).toBe('wrong_status: This order is confirmed, so it can’t be changed');
    expect(outcome(() => mayEdit('order', 'confirmed', true))).toBe('ok');
    expect(outcome(() => mayEdit('order', 'closed', true))).toBe('wrong_status: This order is closed, so it can’t be changed');
  });
});

describe('checkDate', () => {
  it('takes today and any day before, and refuses tomorrow (RC-111)', () => {
    expect(outcome(() => checkDate('2026-11-19', '2026-11-19'))).toBe('ok');
    expect(outcome(() => checkDate('2026-11-01', '2026-11-19'))).toBe('ok');
    expect(outcome(() => checkDate('2026-11-20', '2026-11-19')))
      .toBe('date_in_future: A document can’t be dated after today / businessDate in_future Today is 2026-11-19');
  });
  it('takes the source’s own day and any after, and refuses the day before', () => {
    const quote = { date: '2026-11-10', what: 'quote' };
    expect(outcome(() => checkDate('2026-11-10', '2026-11-19', quote))).toBe('ok');
    expect(outcome(() => checkDate('2026-11-09', '2026-11-19', quote)))
      .toBe('date_before_source: It can’t be dated before its quote / businessDate before_source Its quote is dated 2026-11-10');
  });
});

describe('netRate', () => {
  it("takes a line's discount off its rate, to a rate's 6 places", () => {
    expect(netRate('61250', '0')).toBe('61250.000000');
    expect(netRate('100', '12.5')).toBe('87.500000');
    expect(netRate('10', '33.333333')).toBe('6.666667');
  });
});

describe('lineValues', () => {
  it('rounds the taxable value, then its GST, each to the paisa', () => {
    expect(lineValues({ qty: '3', rate: '33.335', discountPercent: '10', gstPercent: '18' })).toEqual({ taxable: '90.00', gst: '16.20' });
  });
});

// ADR-006 §4: a part return takes round(V × q / Q, 2); the one taking the last of the line clears what's left exactly.
describe('shareOf', () => {
  it('takes a part return’s share, rounded to the paisa', () => {
    expect(shareOf('100.00', '3', { qty: '0', share: '0' }, '1')).toBe('33.33');
    expect(shareOf('100.00', '3', { qty: '1', share: '33.33' }, '1')).toBe('33.33');
  });
  it('clears what’s left with the last return, so the shares add up to the line', () => {
    expect(shareOf('100.00', '3', { qty: '2', share: '66.66' }, '1')).toBe('33.34');
    expect(shareOf('100.00', '3', { qty: '0', share: '0' }, '3')).toBe('100.00');
  });
});

// The architect on RAD-113: a tax-inclusive list's rate before GST, exact, with cess in the formula though it's 0 today.
describe('listRateBeforeTax', () => {
  it('leaves a list rate before GST as it is, and takes GST and cess out of an inclusive one', () => {
    expect(listRateBeforeTax('1000', false, '18')).toBe('1000');
    expect(listRateBeforeTax('1180', true, '18')).toBe('1000');
    // (1,230 − 10 per unit) × 100 / (100 + 18 + 4).
    expect(listRateBeforeTax('1230', true, '18', { percent: '4', perUnit: '10' })).toBe('1000');
  });
  it('judges an inclusive list at 18% at exactly the allowed discount as not over, and 0.01 deeper as over', () => {
    const list = listRateBeforeTax('1180', true, '18');
    expect([overDiscount(list, '900', '10'), overDiscount(list, '899.99', '10')]).toEqual([false, true]);
  });
  it('compares exactly: a rate a hair below the list is over, though a list rounded to 6 places would let it pass', () => {
    const exact = listRateBeforeTax('1000', true, '18');
    expect(exact.startsWith('847.4576271186440677966')).toBe(true);
    expect([overDiscount(exact, '847.457627', '0'), overDiscount('847.457627', '847.457627', '0')]).toEqual([true, false]);
  });
});
