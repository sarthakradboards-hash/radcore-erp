import type { ReactNode } from 'react';
import { LiveRegion } from '../components/ui/live-region.tsx';
import '../styles/tokens.css';
import '../styles/globals.css';

export const metadata = { title: 'RadCore' };
export const viewport = { colorScheme: 'light dark' };
// Every screen renders per request, so each gets its own CSP nonce (proxy.ts) and is never cached (no-store).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {children}
        <LiveRegion />
      </body>
    </html>
  );
}
