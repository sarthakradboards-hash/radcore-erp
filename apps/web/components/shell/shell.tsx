'use client';
// The frame every signed-in screen lives in (M1-40): a skip link, a sticky header with the menu built from the
// person's permissions (RC-151), who is signed in with Sign out (RAD-55), and the screen itself as <main>.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { t } from '../../lib/i18n/index.ts';
import { SignOutButton } from '../auth/sign-out.tsx';
import { Menu } from '../ui/dialog/menu.tsx';
import { Bell } from './bell.tsx';
import { isCurrent, menuFor, NAV } from './nav.ts';
import { useMe } from './session-provider.tsx';

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const path = usePathname();
  const entries = menuFor(NAV, me.permissions);
  return (
    <>
      <a className="skip-link" href="#main">{t('shell.skip')}</a>
      <header className="shell-header">
        {/* The same entries twice: a row of links, and at phone width one Menu button, so every entry is a tap away and
            none scrolls out of sight (e2e on #232). CSS shows one; the other is display: none, so it isn't announced. */}
        <nav aria-label={t('shell.menu')}>
          <ul className="shell-menu-list">
            {entries.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={isCurrent(item, path) ? 'page' : undefined}>{t(item.label)}</Link>
              </li>
            ))}
          </ul>
          <div className="shell-menu-button">
            <Menu label={t('shell.menuButton')}
              items={entries.map((item) => ({ label: t(item.label), href: item.href, current: isCurrent(item, path) }))} />
          </div>
        </nav>
        <div className="shell-user">
          <Bell />
          <p className="shell-user-name">{t('shell.signedInAs', { name: me.user.displayName })}</p>
          <SignOutButton userId={me.user.id} />
        </div>
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
    </>
  );
}
