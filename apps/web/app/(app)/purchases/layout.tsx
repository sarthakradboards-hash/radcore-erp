// The purchasing area (RAD-143): purchase orders and their approvals. Every route behind it checks its own permission
// on the server (purchasing:*); the shell's menu shows the area by permission.
import type { ReactNode } from 'react';
import { PURCHASES_PAGES } from '../../../components/shell/nav.ts';
import { t } from '../../../lib/i18n/index.ts';
import { SectionNav } from '../admin/shared.tsx';

export default function PurchasesLayout({ children }: { children: ReactNode }) {
  return (
    // A <div>: the shell (RAD-50) already gives every signed-in screen its one <main>.
    <div className="admin">
      <SectionNav label={t('purchases.nav')} pages={PURCHASES_PAGES} />
      {children}
    </div>
  );
}
