import type { ReactNode } from 'react';
import { SignedOutDialog } from '../components/auth/signed-out-dialog.tsx';
import { LiveRegion } from '../components/ui/live-region.tsx';
import { ApiProvider } from '../lib/api/provider.tsx';
import { ClientErrorListener } from '../lib/errors/client-error-listener.tsx';
import { t } from '../lib/i18n/index.ts';
import { OfflineBanner } from '../lib/offline/offline-banner.tsx';
import '../styles/tokens.css';
import '../styles/globals.css';

export const metadata = { title: 'RadCore' };
// viewport-fit=cover lets the home-screen app use the whole screen; globals.css pads the notch back in (RC-219).
export const viewport = { colorScheme: 'light dark', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
// Every screen renders per request, so each gets its own CSP nonce (proxy.ts) and is never cached (no-store).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <ClientErrorListener />
        <OfflineBanner />
        <ApiProvider>
          {children}
          <SignedOutDialog />
        </ApiProvider>
        <LiveRegion />
        {/* Shown by CSS alone, and only below the supported-browser floor (decisions.md, 7 Nov). */}
        <div className="browser-floor">
          <h1>{t('browser.title')}</h1>
          <p>{t('browser.body')}</p>
        </div>
      </body>
    </html>
  );
}
