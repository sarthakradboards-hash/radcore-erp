import type { ReactNode } from 'react';
import { LiveRegion } from '../components/ui/live-region.tsx';
import '../styles/tokens.css';
import '../styles/globals.css';

export const metadata = { title: 'RadCore' };
export const viewport = { colorScheme: 'light dark' };

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
