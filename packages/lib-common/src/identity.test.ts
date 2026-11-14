import { describe, expect, it } from 'vitest';
import {
  emailString, GST_STATES, gstinCheckChar, gstinParts, gstinString, idString, isGstin, isPan, normaliseEmail,
  normalisePhone, panString, phoneString, skuString, stateCodeString, stateName,
} from './index.ts';

// 27AAPFU0939F1ZV is the worked example in GSTN's GSTIN format guide; the other two are published GSTINs whose
// check characters were not computed by this code.
const REAL = ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '24AAACC1206D1ZM'];

describe('RC-045: GSTIN checked by format, state and check character', () => {
  it.each(REAL)('accepts %s', (g) => {
    expect(isGstin(g)).toBe(true);
    expect(gstinCheckChar(g.slice(0, 14))).toBe(g.charAt(14));
    expect(gstinString().safeParse(g).success).toBe(true);
  });

  it.each([
    ['27AAPFU0939F1ZW', 'wrong check character'],
    ['27AAPFU0939F1Z', 'too short'],
    ['27AAPFU0939F1ZVV', 'too long'],
    ['27aapfu0939f1zv', 'lower case'],
    ['00AAPFU0939F1ZV', 'no such state'],
    ['39AAPFU0939F1ZV', 'no such state'],
    ['27AAPXU0939F1ZV', 'PAN holder kind X'],
    ['27AAPFU0939F0ZV', 'entity number 0'],
    ['27AAPFU0939F1YV', 'no Z at 14'],
    [' 27AAPFU0939F1ZV', 'leading space'],
  ])('refuses %s (%s)', (g) => {
    expect(isGstin(g)).toBe(false);
    expect(gstinString().safeParse(g).success).toBe(false);
  });

  it('catches every single-character change to a valid GSTIN', () => {
    const g = '27AAPFU0939F1ZV';
    for (let i = 0; i < 15; i++) {
      for (const c of [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((x) => x !== g[i])) {
        expect(isGstin(g.slice(0, i) + c + g.slice(i + 1)), `${i}:${c}`).toBe(false);
      }
    }
  });

  it('reads the state and PAN out of a GSTIN', () => {
    expect(gstinParts('27AAPFU0939F1ZV')).toEqual({ stateCode: '27', state: 'Maharashtra', pan: 'AAPFU0939F' });
    expect(() => gstinParts('27AAPFU0939F1ZW')).toThrow(RangeError);
  });
});

describe('RC-045: PAN format and the state-code lookup', () => {
  it.each([['AAPFU0939F', true], ['ABCPE1234F', true], ['ABCXE1234F', false], ['abcpe1234f', false], ['ABCPE123F', false],
    ['ABCPE12345', false]])('PAN %s is %s', (p, ok) => {
    expect(isPan(p)).toBe(ok);
    expect(panString().safeParse(p).success).toBe(ok);
  });

  it('knows every current state code and nothing else', () => {
    expect(stateName('27')).toBe('Maharashtra');
    expect(stateName('38')).toBe('Ladakh');
    expect(stateName('99')).toBe('Centre Jurisdiction');
    expect(Object.keys(GST_STATES)).toHaveLength(40);
    for (const bad of ['00', '39', '96', '7', 'toString', '__proto__']) {
      expect(stateName(bad), bad).toBeUndefined();
      expect(stateCodeString().safeParse(bad).success).toBe(false);
    }
  });
});

describe('phone, email, SKU and ids', () => {
  it.each([['98765 43210', '+919876543210'], ['+91 98765 43210', '+919876543210'], ['09876543210', '+919876543210'],
    ['022 2345 6789', '+912223456789'], ['+1 415 555 2671', '+14155552671']])('normalises %s to %s', (raw, e164) => {
    expect(normalisePhone(raw)).toBe(e164);
    expect(phoneString().safeParse(raw).success).toBe(true);
  });

  it.each(['9876543', '+91 98765 432100', 'abc', ''])('refuses the phone number "%s"', (raw) => {
    expect(normalisePhone(raw)).toBeUndefined();
    expect(phoneString().safeParse(raw).success).toBe(false);
  });

  it('stores one spelling of an email address', () => {
    expect(normaliseEmail('  Asha.Rao@Example.COM ')).toBe('asha.rao@example.com');
    expect(normaliseEmail('A@B.in')).toBe(normaliseEmail('a@b.IN'));
    expect(emailString().safeParse('asha@example.com').success).toBe(true);
    expect(emailString().safeParse('asha@').success).toBe(false);
  });

  it.each([['RB-100', true], ['rb_100.v2/blk', true], [' RB-100', false], ['RB 100', false], ['', false],
    ['A'.repeat(65), false]])('SKU "%s" is %s', (s, ok) => expect(skuString().safeParse(s).success).toBe(ok));

  it('checks record ids', () => {
    expect(idString().safeParse('3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01').success).toBe(true);
    expect(idString().safeParse('42').success).toBe(false);
  });
});
