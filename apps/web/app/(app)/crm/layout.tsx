// The CRM area (RAD-122): leads and the pipeline. Every route behind it checks its own permission on the server
// (leads:*); the shell's menu shows the area by permission.
import type { ReactNode } from 'react';
import { CRM_PAGES } from '../../../components/shell/nav.ts';
import { t } from '../../../lib/i18n/index.ts';
import { SectionNav } from '../admin/shared.tsx';
import './crm.css';

export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    // A <div>: the shell (RAD-50) already gives every signed-in screen its one <main>.
    <div className="admin">
      <SectionNav label={t('crm.nav')} pages={CRM_PAGES} />
      {children}
    </div>
  );
}
