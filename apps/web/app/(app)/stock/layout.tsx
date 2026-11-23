// The stock area (RAD-144): counts, adjustments and their approvals. Every route behind it checks its own permission on
// the server (stock:*); the shell's menu shows the area by permission.
import type { ReactNode } from 'react';
import { STOCK_PAGES } from '../../../components/shell/nav.ts';
import { t } from '../../../lib/i18n/index.ts';
import { SectionNav } from '../admin/shared.tsx';

export default function StockLayout({ children }: { children: ReactNode }) {
  return (
    // A <div>: the shell (RAD-50) already gives every signed-in screen its one <main>.
    <div className="admin">
      <SectionNav label={t('stock.nav')} pages={STOCK_PAGES} />
      {children}
    </div>
  );
}
