'use client';
// The CRM's lists (RAD-122 on RAD-109's contracts): lost reasons, follow-up plans and quick replies, the choices the
// sales team picks from on a lead. leads:setup keeps them; the server checks it on every change.
import { getLeadLists } from '@radcore/lib-crm/contract';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { Plans } from './plans.tsx';
import { LostReasons, QuickReplies } from './simple-lists.tsx';

export default function CrmListsPage() {
  const mayWrite = useMe().permissions.includes('leads:setup');
  const q = useApiQuery(getLeadLists, {});
  return (
    <>
      <h1>{t('crm.lists.title')}</h1>
      <p>{t('crm.lists.intro')}</p>
      <LostReasons q={q} mayWrite={mayWrite} />
      <Plans q={q} mayWrite={mayWrite} />
      <QuickReplies q={q} mayWrite={mayWrite} />
    </>
  );
}
