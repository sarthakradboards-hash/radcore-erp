'use client';
// Second-factor enrolment (M1-15, RAD-55): the otpauth:// URI from startSecondFactorEnrolment, shown as a QR code to
// scan and as a key to type. Drawn in the browser by qrcode (ADR-003): the secret never goes to an outside service.
// Shown through an <img> (next/image, unoptimized, so a plain img) with a data: URL, never inserted as HTML
// (ADR-002 L6); the CSP allows data: images.
import Image from 'next/image';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { t } from '../../lib/i18n/index.ts';

/** The QR code as an SVG data: URL. Medium error correction survives a glare-washed phone screen. */
export const qrDataUrl = async (uri: string): Promise<string> =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }))}`;

/** The base32 secret from a TOTP otpauth:// URI, in groups of four for typing, or null if it isn't one. */
export function otpauthSecret(uri: string): string | null {
  let url: URL;
  try { url = new URL(uri); } catch { return null; }
  if (url.protocol !== 'otpauth:' || url.host !== 'totp') return null;
  const secret = url.searchParams.get('secret')?.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return secret ? (secret.match(/.{1,4}/g) ?? []).join(' ') : null;
}

/** @public sign-in screen API: its first caller is RAD-55's enrolment screen. */
export function EnrolmentQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void qrDataUrl(uri).then((url) => { if (current) setSrc(url); });
    return () => { current = false; };
  }, [uri]);
  const secret = otpauthSecret(uri);
  return (
    <figure className="enrolment-qr">
      {src
        ? <Image src={src} alt={t('enrol.qrAlt')} width={192} height={192} unoptimized />
        : <div className="enrolment-qr-placeholder" aria-busy="true" />}
      {secret ? <figcaption>{t('enrol.typeKey')} <code>{secret}</code></figcaption> : null}
    </figure>
  );
}
