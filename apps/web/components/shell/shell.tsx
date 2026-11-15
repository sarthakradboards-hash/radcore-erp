'use client';
// The frame every signed-in screen lives in (M1-40): a skip link, a sticky header with the menu built from the
// person's permissions (RC-151), who is signed in with Sign out (RAD-55), and the screen itself as <main>.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { t } from '../../lib/i18n/index.ts';
import { SignOutButton } from '../auth/sign-out.tsx';
import { isCurrent, menuFor, NAV } from './nav.ts';
import { useMe } from './session-provider.tsx';

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const path = usePathname();
  return (
    <>
      <a className="skip-link" href="#main">{t('shell.skip')}</a>
      <header className="shell-header">
        <nav aria-label={t('shell.menu')}>
          <ul>
            {menuFor(NAV, me.permissions).map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={isCurrent(item, path) ? 'page' : undefined}>{t(item.label)}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="shell-user">
          <p>{t('shell.signedInAs', { name: me.user.displayName })}</p>
          <SignOutButton userId={me.user.id} />
        </div>
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
    </>
  );
}
