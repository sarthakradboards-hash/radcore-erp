'use client';
// Campaigns (RAD-122 on RAD-110's contracts): newest first, running or ended. campaigns:write makes one, counted under a
// website form or QR source, and ends it. Each has its link to the public enquiry page; the screen draws its QR code in
// the browser with qrcode (ADR-003, the enrolment screen's qrDataUrl), as an <img> from a data: URL, never inserted as
// HTML. The link's token grants nothing beyond tagging an enquiry (the architect on RAD-110).
import { formatMoment } from '@radcore/lib-common';
import { createCampaign, endCampaign, listCampaigns, listLeadSources } from '@radcore/lib-crm/contract';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { qrDataUrl } from '../../../../components/auth/enrolment-qr.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu } from '../../../../components/ui/dialog/menu.tsx';
import { SelectField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons, ConfirmDialog } from '../../admin/shared.tsx';
import { CRM_MESSAGES } from '../shared.ts';

type Campaign = z.output<typeof listCampaigns.output>['items'][number];
type Show = 'running' | 'ended' | 'all';
const later = (text: string) => setTimeout(() => announce(text), 0);
const campaignSchema = z.object({
  name: createCampaign.input.shape.name,
  sourceId: z.string().min(1, t('crm.campaigns.source.pick')).pipe(createCampaign.input.shape.sourceId),
});

/** The campaign's link, whole, and its QR code, drawn here. */
function LinkDialog({ campaign, onOpenChange }: { campaign: Campaign; onOpenChange: (open: boolean) => void }) {
  const link = `${window.location.origin}${campaign.path}`;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void qrDataUrl(link).then((url) => { if (current) setSrc(url); });
    return () => { current = false; };
  }, [link]);
  return (
    <Dialog open onOpenChange={onOpenChange} title={t('crm.campaigns.link.title', { name: campaign.name })} description={t('crm.campaigns.link.body')}>
      <figure className="enrolment-qr">
        {src ? <Image src={src} alt={t('crm.campaigns.qrAlt', { name: campaign.name })} width={240} height={240} unoptimized />
          : <div className="enrolment-qr-placeholder" aria-busy="true" />}
        <figcaption><code className="crm-message">{link}</code></figcaption>
      </figure>
      <div className="kit-actions">
        <button type="button" className="kit-button"
          onClick={() => void navigator.clipboard.writeText(link).then(() => announce(t('crm.campaigns.copied')), () => announce(t('crm.campaigns.copyFailed')))}>
          {t('crm.campaigns.copy')}
        </button>
        <CloseButton>{t('crm.cancel')}</CloseButton>
      </div>
    </Dialog>
  );
}

export default function CampaignsPage() {
  const { permissions } = useMe();
  const mayWrite = permissions.includes('campaigns:write');
  const maySources = permissions.includes('leads:setup');
  const [show, setShow] = useState<Show>('running');
  const list = useApiList(listCampaigns, { filter: show === 'all' ? {} : { ended: show === 'ended' } });
  // Sources are read under leads:setup (marketing holds it by default); a role without it can't pick one here.
  const sources = useApiQuery(listLeadSources, {}, { enabled: maySources }).data?.sources ?? [];
  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? '';
  const choices = sources.filter((s) => s.active && (s.channel === 'form' || s.channel === 'qr')).map((s) => ({ value: s.id, label: s.name }));
  const [acting, setActing] = useState<{ kind: 'add' } | { kind: 'link' | 'end'; campaign: Campaign } | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const create = useApiMutation(createCampaign, { invalidates: [listCampaigns] });
  const end = useApiMutation(endCampaign, { invalidates: [listCampaigns] });
  const columns: Column<Campaign>[] = [
    { id: 'name', header: t('crm.col.name'), cell: (c) => c.name },
    { id: 'source', header: t('crm.campaigns.col.source'), cell: (c) => sourceName(c.sourceId) },
    { id: 'state', header: t('crm.campaigns.col.state'), cell: (c) => (c.endedAt === null ? t('crm.campaigns.running') : t('crm.campaigns.endedOn', { when: formatMoment(c.endedAt) })) },
    { id: 'actions', header: t('admin.users.col.actions'), cell: (c) => (
      <Menu label={t('crm.actionsFor', { name: c.name })} items={[
        { label: t('crm.campaigns.link'), onSelect: () => setActing({ kind: 'link', campaign: c }) },
        ...(mayWrite && c.endedAt === null ? [{ label: t('crm.campaigns.end'), onSelect: () => setActing({ kind: 'end', campaign: c }) }] : []),
      ]} />
    ) },
  ];
  const picked = acting?.kind === 'link' || acting?.kind === 'end' ? acting.campaign : undefined;
  return (
    <>
      <h1>{t('crm.campaigns.title')}</h1>
      <p>{t('crm.campaigns.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('crm.campaigns.col.state')} value={show} onChange={setShow} options={[
          { value: 'running', label: t('crm.campaigns.show.running') }, { value: 'ended', label: t('crm.campaigns.show.ended') },
          { value: 'all', label: t('crm.campaigns.show.all') },
        ]} />
        {mayWrite ? <button type="button" className="kit-button kit-button-primary" onClick={() => setActing({ kind: 'add' })}>{t('crm.campaigns.add')}</button> : null}
      </div>
      <DataTable caption={t('crm.campaigns.title')} columns={columns} rowKey={(c) => c.id} list={list} empty={t('crm.campaigns.empty')} />

      <Dialog open={acting?.kind === 'add'} onOpenChange={close} title={t('crm.campaigns.add')}>
        {!maySources ? <p>{t('crm.campaigns.cannotSources')}</p> : choices.length === 0 ? <p>{t('crm.campaigns.noSources')}</p> : (
          <Form schema={campaignSchema} saved={false} messages={CRM_MESSAGES} defaultValues={{ name: '', sourceId: '' }}
            onSubmit={async (v) => { await create.submit(v); setActing(null); later(t('crm.campaigns.added')); }}>
            <TextField name="name" label={t('crm.col.name')} autoComplete="off" />
            <SelectField name="sourceId" label={t('crm.campaigns.source')} hint={t('crm.campaigns.source.hint')}
              placeholder={t('crm.campaigns.source.pick')} options={choices} />
            <div className="kit-actions"><CloseButton>{t('crm.cancel')}</CloseButton><SubmitButton>{t('crm.add')}</SubmitButton></div>
          </Form>
        )}
      </Dialog>
      {acting?.kind === 'link' && picked !== undefined ? <LinkDialog campaign={picked} onOpenChange={close} /> : null}
      <ConfirmDialog open={acting?.kind === 'end'} onOpenChange={close} messages={CRM_MESSAGES}
        title={t('crm.campaigns.end.title', { name: picked?.name ?? '' })} body={t('crm.campaigns.end.body')} action={t('crm.campaigns.end')}
        done={t('crm.campaigns.ended')} onConfirm={async () => { if (picked !== undefined) await end.submit({ id: picked.id }); }} />
    </>
  );
}
