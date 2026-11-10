// M1-15 / RAD-55: the enrolment code is drawn locally, and its key can be typed by hand.
import { expect, it } from 'vitest';
import { otpauthSecret, qrDataUrl } from './enrolment-qr.tsx';

const URI = 'otpauth://totp/RadCore:asha%40example.in?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=RadCore';

it('draws the URI as an SVG data: URL, with nothing fetched', async () => {
  const url = await qrDataUrl(URI);
  expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  expect(decodeURIComponent(url.split(',')[1]!)).toMatch(/^<svg[^>]*>.*<\/svg>\s*$/s);
});

it('reads the key in groups of four', () => {
  expect(otpauthSecret(URI)).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
  expect(otpauthSecret('otpauth://totp/x?secret=jbsw y3dp')).toBe('JBSW Y3DP');
});

it.each(['https://example.in/?secret=JBSWY3DP', 'otpauth://hotp/x?secret=JBSWY3DP', 'otpauth://totp/x', 'not a url'])(
  'answers null for %s', (uri) => {
    expect(otpauthSecret(uri)).toBeNull();
  });
