import { describe, expect, it } from 'vitest';
import { auditValue } from './value.ts';

describe('an audited value', () => {
  it('keeps a mask as a mask, so the kit says "Hidden", never its JSON (e2e on #230)', () => {
    expect(auditValue({ masked: '••••••' }, '-')).toEqual({ masked: '••••••' });
    expect(auditValue({ masked: '••••••3210' }, '-')).toEqual({ masked: '••••••3210' });
  });

  it('shows text as it came, a missing value as the screen says, and anything else as JSON', () => {
    expect(auditValue('1250.50', '-')).toBe('1250.50');
    expect(auditValue(undefined, 'None')).toBe('None');
    expect(auditValue(null, '-')).toBe('null');
    expect(auditValue(true, '-')).toBe('true');
    expect(auditValue({ a: 1 }, '-')).toBe('{"a":1}');
  });
});
