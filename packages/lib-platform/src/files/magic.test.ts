// RAD-43, ADR-003 §3's conditions: each kind's sample confirms as its own type and as no other, and an empty,
// truncated or renamed file fails. The samples are each format's real opening bytes.
import { describe, expect, it } from 'vitest';
import { confirmsType } from './magic.ts';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const len = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

const SAMPLES: Record<string, Uint8Array> = {
  'image/jpeg': bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  'image/png': bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], len(13), 'IHDR', len(1), len(1), [8, 6, 0, 0, 0]),
  'image/webp': bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ', [0x18, 0, 0, 0]),
  'image/heic': bytes(len(24), 'ftypheic', len(0), 'mif1heic'),
  'application/pdf': bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n'),
  [XLSX]: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0], '[Content_Types].xml'),
  'text/csv': bytes('date,narration,amount\n2026-11-01,UPI/कॉफ़ी,120.00\n'),
};
const TYPES = Object.keys(SAMPLES);

describe('confirmsType', () => {
  it.each(TYPES)('confirms a %s sample as itself', (type) => {
    expect(confirmsType(type, SAMPLES[type] ?? new Uint8Array())).toBe(true);
  });

  it.each(TYPES.flatMap((declared) => TYPES.filter((t) => t !== declared).map((actual) => [declared, actual])))(
    'refuses a file declared %s that is really %s', (declared, actual) => {
      expect(confirmsType(declared, SAMPLES[actual] ?? new Uint8Array())).toBe(false);
    });

  it.each(TYPES)('refuses an empty file declared %s', (type) => {
    expect(confirmsType(type, new Uint8Array())).toBe(false);
  });

  it.each([
    ['image/png', bytes([0x89], 'PNG')],
    ['image/webp', bytes('RIFF', [0, 0, 0, 0], 'WEB')],
    ['image/heic', bytes(len(24), 'ftyp')],
    ['image/heic', bytes(len(24), 'ftypavif')],
    ['image/jpeg', bytes([0xff, 0xd8])],
    [XLSX, bytes('PK')],
  ])('refuses a truncated or wrong-brand %s', (type, head) => {
    expect(confirmsType(type, head)).toBe(false);
  });

  it('finds a PDF header within the first 1 KB, not beyond', () => {
    const at = (offset: number) => bytes(' '.repeat(offset), '%PDF-1.4');
    expect(confirmsType('application/pdf', at(1000))).toBe(true);
    expect(confirmsType('application/pdf', at(1020))).toBe(false);
  });

  it('refuses a CSV with a NUL byte, and any type it has no check for', () => {
    expect(confirmsType('text/csv', bytes('a,b\n', [0], '1,2\n'))).toBe(false);
    expect(confirmsType('text/plain', bytes('hello'))).toBe(false);
  });
});
