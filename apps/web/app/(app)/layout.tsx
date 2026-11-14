// Every signed-in screen lives under this layout. It reads the session on the server before rendering (RC-214), and
// sends anyone not signed in to the sign-in page (RAD-55) instead of showing a screen that can't load.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SessionProvider } from '../../components/shell/session-provider.tsx';
import { Shell } from '../../components/shell/shell.tsx';
import { readMe } from '../../lib/session/read-me.ts';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const me = await readMe({ cookie: h.get('cookie'), forwardedFor: h.get('x-forwarded-for') });
  // shortcut: no ?next= back to the page asked for, since a layout can't see its path; RAD-55 adds it with sign-in.
  if (!me) redirect('/sign-in');
  return (
    <SessionProvider initial={me}>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
