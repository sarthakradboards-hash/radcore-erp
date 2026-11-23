// The public enquiry page (RAD-122 on RAD-107's form door): the website links here; it isn't framed (Sarthak: link only;
// frame-ancestors 'none'). A campaign's link or QR code opens it with its token. No sign-in, no menu. Its CSP alone allows Cloudflare Turnstile (proxy.ts); every
// other page keeps none. The site key is web's own setting (TURNSTILE_SITE_KEY), read here on the server; without it the
// page says the form isn't available rather than offering one that can't send.
import { Suspense } from 'react';
import { t } from '../../../lib/i18n/index.ts';
import { EnquiryForm } from './enquiry-form.tsx';

export const metadata = { title: `${t('crm.public.title')} · RadCore`, robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function EnquiryPage() {
  const siteKey = process.env['TURNSTILE_SITE_KEY'] ?? '';
  return (
    <main id="main" className="public-invoice">
      <h1 id="enquiry-title">{t('crm.public.title')}</h1>
      <p>{t('crm.public.intro')}</p>
      {siteKey === '' ? <p role="alert" className="kit-form-alert">{t('crm.public.unavailable')}</p> : (
        // useSearchParams needs a Suspense boundary on a page rendered per request.
        <Suspense fallback={<p>{t('loading')}</p>}><EnquiryForm siteKey={siteKey} /></Suspense>
      )}
    </main>
  );
}
