// Our own page, because Next's built-in one styles itself with a <style> element that the CSP (proxy.ts) blocks.
import Link from 'next/link';
import { t } from '../lib/i18n/index.ts';

export const metadata = { title: `${t('notFound.title')} · RadCore` };

export default function NotFound() {
  return (
    <main className="page-message">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <p><Link href="/">{t('notFound.home')}</Link></p>
    </main>
  );
}
