'use client';
// Shown when the root layout itself fails. It replaces the whole document, so it brings its own <html>, title and
// stylesheets; Next's built-in page styles itself with a <style> element that the CSP (proxy.ts) blocks.
import { t } from '../lib/i18n/index.ts';
import '../styles/tokens.css';
import '../styles/globals.css';
import { referenceOf } from './error.tsx';

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const reference = referenceOf(error);
  return (
    <html lang="en-IN">
      <head><title>{`${t('error.title')} · RadCore`}</title></head>
      <body>
        <main className="page-message">
          <h1>{t('error.title')}</h1>
          <p>{t('error.body')}</p>
          {reference ? <p>{t('error.reference', { id: reference })}</p> : null}
          <p><button type="button" onClick={retry}>{t('error.retry')}</button></p>
        </main>
      </body>
    </html>
  );
}
