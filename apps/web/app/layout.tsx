import type { ReactNode } from 'react';

export const metadata = { title: 'RadCore' };
// Every screen renders per request, so each gets its own CSP nonce (proxy.ts) and is never cached (no-store).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
