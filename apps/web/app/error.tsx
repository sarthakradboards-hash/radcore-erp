'use client';
// A screen that fails is replaced by this, inside the root layout, so the rest of the app keeps working (RC-159).
// Typed work survives through the forms' draft autosave (RAD-52, used by RAD-53's forms), not through this screen.
import { useEffect } from 'react';
import { t } from '../lib/i18n/index.ts';

/** Next's server errors carry a `digest`: the same id is in the server log, so an admin can find the cause. */
export const referenceOf = (error: unknown): string | undefined => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' ? digest : undefined;
};

export default function ErrorScreen({ error, retry }: { error: unknown; retry: () => void }) {
  const reference = referenceOf(error);
  // Move focus to the heading, so a keyboard or screen-reader user knows the screen changed.
  useEffect(() => document.getElementById('error-title')?.focus(), []);
  return (
    <main className="page-message">
      <h1 id="error-title" tabIndex={-1}>{t('error.title')}</h1>
      <p>{t('error.body')}</p>
      {reference ? <p>{t('error.reference', { id: reference })}</p> : null}
      <p><button type="button" onClick={retry}>{t('error.retry')}</button></p>
    </main>
  );
}
