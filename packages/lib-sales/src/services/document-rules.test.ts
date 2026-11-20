// RAD-112 (ADR-007 §1, §4; RC-111): quotes' and orders' moves and the bounds on their dates, without a database. Each
// refusal pins its code and message, since a changed message is a change no other test would notice.
import { AppError } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';
import { checkDate, mayEdit, mayMove, ORDER_MOVES, QUOTE_MOVES } from './document-rules.ts';

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
