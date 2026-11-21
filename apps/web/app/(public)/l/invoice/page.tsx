// The buyer's copy of an invoice, opened from the link its seller shared (RAD-125 on RAD-118's contract, ADR-001 §6a, §7a): /l/invoice#token=...
// A public page: no sign-in, no menu. The token stays in the fragment (never sent in the URL or a Referer), is taken once and posted in a
// body. It keeps the strict CSP every page gets (no outside origin, no inline script), and asks not to be indexed or to leak the address.
import { t } from '../../../../lib/i18n/index.ts';
import { InvoiceView } from './invoice-view.tsx';

export const metadata = {
  title: `${t('sales.public.title')} · RadCore`,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PublicInvoicePage() {
  return (
    <main id="main" className="public-invoice">
      <InvoiceView />
    </main>
  );
}
