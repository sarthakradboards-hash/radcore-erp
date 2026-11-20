// The accounts area (RAD-100): the journal and the chart of accounts. Every route behind it checks its own permission
// on the server (journal:*); the shell's menu shows the area by permission.
import type { ReactNode } from 'react';
import { ACCOUNTS_PAGES } from '../../../components/shell/nav.ts';
import { t } from '../../../lib/i18n/index.ts';
import { SectionNav } from '../admin/shared.tsx';

export default function AccountsLayout({ children }: { children: ReactNode }) {
  return (
    // A <div>: the shell (RAD-50) already gives every signed-in screen its one <main>.
    <div className="admin">
      <SectionNav label={t('books.nav')} pages={ACCOUNTS_PAGES} />
      {children}
    </div>
  );
}
