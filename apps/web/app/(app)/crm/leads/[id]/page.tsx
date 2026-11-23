'use client';
// One lead (RAD-122 on RAD-109's contracts): its details, its enquiries and its timeline, newest first, and what can be
// done with it. Its phone and email show unmasked only to pii:read or leads:contact, and the server logs that look; for
// everyone else they're masked (RAD-40). An enquiry's message is what the outsider wrote: it's shown as text, never as
// markup (RC-173). leads:write works the lead; an unowned one becomes the worker's when they work only their own (D-11).
import { formatDate, formatMoment, formatMoney } from '@radcore/lib-common';
import { getLead, getLeadLists } from '@radcore/lib-crm/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId, useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { Pii } from '../../../../../components/ui/masked.tsx';
import { useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { leadName, ownerText, shownStep, stageName } from '../../shared.ts';
import { AssignDialog, EditDialog, FollowUpDialog, MoveDialog, PlanDialog, ReplyDialog } from './lead-dialogs.tsx';

type Dialogs = 'followUp' | 'move' | 'plan' | 'reply' | 'edit' | 'assign' | null;

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const mayWrite = me.permissions.includes('leads:write');
  const q = useApiQuery(getLead, { id });
  const listsQ = useApiQuery(getLeadLists, {});
  const lists = listsQ.data;
  const [dialog, setDialog] = useState<Dialogs>(null);
  const enquiriesId = useId();
  const timelineId = useId();
  const lead = q.data;

  if (q.error !== null || listsQ.error !== null) {
    return (
      <>
        <p><Link href="/crm/leads">{t('crm.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('crm.missing')} <button type="button" className="kit-button" onClick={() => { void q.refetch(); void listsQ.refetch(); }}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (lead === undefined || lists === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const plan = lists.plans.find((p) => p.id === lead.planId);
  const step = plan === undefined ? null : shownStep(plan.steps, lead.planStep);
  const lostReason = lists.lostReasons.find((r) => r.id === lead.lostReasonId);
  return (
    <>
      <p><Link href="/crm/leads">{t('crm.back')}</Link></p>
      <h1>{leadName(lead.name, lead.phone)}</h1>
      {lead.owner === null ? <p className="admin-notice">{t('crm.unowned')}</p> : null}
      <dl className="admin-facts" aria-label={t('crm.facts')}>
        <dt>{t('crm.phone')}</dt><dd><Pii value={lead.phone} /></dd>
        <dt>{t('crm.email')}</dt><dd>{lead.email === null ? t('crm.none') : <Pii value={lead.email} />}</dd>
        <dt>{t('crm.stage')}</dt><dd>{stageName(lead.stage)}</dd>
        {lostReason === undefined ? null : <><dt>{t('crm.lostReason')}</dt><dd>{lostReason.label}</dd></>}
        <dt>{t('crm.owner')}</dt><dd>{ownerText(lead.owner, me.user.id)}</dd>
        <dt>{t('crm.followUpOn')}</dt><dd>{lead.followUpOn === null ? t('crm.followUpNone') : formatDate(lead.followUpOn)}</dd>
        {plan === undefined ? null : (
          <><dt>{t('crm.plan')}</dt><dd>{step === null ? plan.name : t('crm.plan.step', { plan: plan.name, step: String(step) })}</dd></>
        )}
        <dt>{t('crm.value')}</dt><dd>{lead.value === null ? t('crm.none') : formatMoney(lead.value)}</dd>
        <dt>{t('crm.score')}</dt><dd>{lead.score === null ? t('crm.none') : String(lead.score)}</dd>
        <dt>{t('crm.notes')}</dt><dd className="crm-message">{lead.notes ?? t('crm.none')}</dd>
      </dl>

      {mayWrite ? (
        <div className="kit-actions">
          <button type="button" className="kit-button kit-button-primary" onClick={open('followUp')}>{t('crm.action.followUp')}</button>
          <button type="button" className="kit-button" onClick={open('move')}>{t('crm.action.stage')}</button>
          <button type="button" className="kit-button" onClick={open('plan')}>{t('crm.action.plan')}</button>
          <button type="button" className="kit-button" onClick={open('reply')}>{t('crm.action.reply')}</button>
          <button type="button" className="kit-button" onClick={open('edit')}>{t('crm.action.edit')}</button>
          <button type="button" className="kit-button" onClick={open('assign')}>{t('crm.action.assign')}</button>
        </div>
      ) : null}

      <section aria-labelledby={enquiriesId}>
        <h2 id={enquiriesId}>{t('crm.enquiries')}</h2>
        <ol className="crm-list">
          {lead.enquiries.map((e, n) => (
            <li key={n}>
              <p className="crm-list-head">{t('crm.enquiry.at', { source: t(`crm.enquiry.source.${e.source}`), when: formatMoment(e.receivedAt) })}</p>
              <p className="crm-message">{e.message ?? t('crm.enquiry.noMessage')}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby={timelineId}>
        <h2 id={timelineId}>{t('crm.timeline')}</h2>
        {lead.activities.length === 0 ? <p>{t('crm.timeline.empty')}</p> : (
          <ol className="crm-list">
            {lead.activities.map((a, n) => {
              const what = a.kind === 'follow_up' ? t('crm.activity.follow_up')
                : a.kind === 'quick_reply' ? t('crm.activity.quick_reply', { title: a.note ?? '' })
                : t('crm.activity.stage', { stage: a.stage === null ? '' : stageName(a.stage) });
              return (
                <li key={n}>
                  <p className="crm-list-head">
                    {t('crm.activity.by', { what, who: a.by.displayName ?? t('crm.activity.someone'), when: formatMoment(a.at) })}
                  </p>
                  {a.kind === 'quick_reply' || a.note === null ? null : <p className="crm-message">{a.note}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Mounted only while open, so each one starts from the lead as it is now. */}
      {dialog === 'followUp' ? <FollowUpDialog id={id} open onOpenChange={shut} /> : null}
      {dialog === 'move' ? <MoveDialog lead={lead} lists={lists} open onOpenChange={shut} /> : null}
      {dialog === 'plan' ? <PlanDialog lead={lead} lists={lists} open onOpenChange={shut} /> : null}
      {dialog === 'reply' ? <ReplyDialog id={id} lists={lists} open onOpenChange={shut} /> : null}
      {dialog === 'edit' ? <EditDialog lead={lead} open onOpenChange={shut} /> : null}
      {dialog === 'assign' ? <AssignDialog id={id} open onOpenChange={shut} /> : null}
    </>
  );
}

