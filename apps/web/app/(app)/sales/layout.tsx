// The sales area (RAD-125): quotes and orders, and the documents that follow them. Every route behind it checks its own
// permission on the server (sales:*); the shell's menu shows the area by permission.
import type { ReactNode } from 'react';
import { SALES_PAGES } from '../../../components/shell/nav.ts';
import { t } from '../../../lib/i18n/index.ts';
import { SectionNav } from '../admin/shared.tsx';

export default function SalesLayout({ children }: { children: ReactNode }) {
  return (
    // A <div>: the shell (RAD-50) already gives every signed-in screen its one <main>.
    <div className="admin">
      <SectionNav label={t('sales.nav')} pages={SALES_PAGES} />
      {children}
    </div>
  );
}
