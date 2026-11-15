// A value the server masked for this person (RAD-40, RAD-103). The wire sends `{ masked }`: six bullets, then the last
// 4 characters for a last-4 field (phone, PAN). The bullets are shown but hidden from screen readers, which read
// "Hidden", or "Hidden, ends 3210" (the architect on RAD-40) instead of "bullet bullet…".
import { isMasked, type Masked } from '@radcore/lib-common';
import { t } from '../../lib/i18n/index.ts';

/** What a screen reader says in place of a mask. */
export function maskedLabel({ masked }: Masked): string {
  const end = masked.replace(/^•+/, '');
  return end === '' ? t('kit.masked') : t('kit.masked.ends', { end });
}

/** A pii() value as text: the value itself, or its mask with the words a screen reader says instead. */
export function Pii({ value }: { value: string | Masked }) {
  if (!isMasked(value)) return value;
  return (
    <>
      <span aria-hidden="true">{value.masked}</span>
      <span className="visually-hidden">{maskedLabel(value)}</span>
    </>
  );
}
