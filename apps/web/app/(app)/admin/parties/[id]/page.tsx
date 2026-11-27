'use client';
// One party (RAD-99 on RAD-90's contracts): its details, contact details masked without parties:contact (RAD-40), and
// its credit terms. parties:write edits its own fields and switches it off or back on (never deleted); a masked
// contact field stays read-only and is never sent. Credit days and limit are set only with parties:manage, which needs
// the second sign-in factor, and take a reason (setPartyCredit is the only way to set them).
import { getParty, listParties, setPartyCredit, updateParty } from '@radcore/lib-accounts/contract';
import { formatMoney } from '@radcore/lib-common';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { Pii } from '../../../../../components/ui/masked.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog, MESSAGES } from '../../shared.tsx';
import { editPartySchema, kindsText, PARTY_MESSAGES, PartyFields, partyStateName } from '../party-fields.tsx';
import { PartyPriceList } from './price-list.tsx';

const credit = setPartyCredit.input.shape;
// Empty boxes are "no credit" (the contract's null); days are typed as text and sent as a whole number.
const creditSchema = z.object({
  creditDays: z.string().trim().transform((s) => (s === '' ? null : Number(s))).pipe(credit.creditDays),
  creditLimit: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(credit.creditLimit),
  reason: credit.reason,
});
const plain = (v: unknown) => (v === null ? '' : v); // a masked value stays as it came, for MaskedField

export default function PartyPage() {
  const { id } = useParams<{ id: string }>();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('parties:write');
  const mayManage = permissions.includes('parties:manage');
  const q = useApiQuery(getParty, { id });
  const refresh = { invalidates: [getParty, listParties] };
  const save = useApiMutation(updateParty, refresh);
  const setCredit = useApiMutation(setPartyCredit, refresh);
  const [toggling, setToggling] = useState(false);
  const p = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/admin/parties">{t('admin.parties.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('admin.parties.missing')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (p === undefined) return <p>{t('loading')}</p>;
  const address = [p.addressLine1, p.addressLine2, p.city, p.pincode].filter((v) => v !== null);

  return (
    <>
      <p><Link href="/admin/parties">{t('admin.parties.back')}</Link></p>
      <h1>{p.name}</h1>
      <dl className="admin-facts" aria-label={t('admin.parties.facts')}>
        <dt>{t('admin.parties.kinds')}</dt><dd>{kindsText(p.kinds)}</dd>
        <dt>{t('admin.parties.gstin')}</dt><dd>{p.gstin ?? t('admin.parties.unregistered')}</dd>
        <dt>{t('admin.parties.pan')}</dt><dd>{p.pan ?? t('admin.items.none')}</dd>
        <dt>{t('admin.parties.state')}</dt><dd>{partyStateName(p.stateCode)} ({p.stateCode})</dd>
        <dt>{t('admin.parties.composition')}</dt><dd>{t(p.composition ? 'admin.parties.yes' : 'admin.parties.no')}</dd>
        <dt>{t('admin.parties.phone')}</dt><dd><Pii value={p.phone ?? t('admin.items.none')} /></dd>
        <dt>{t('admin.parties.email')}</dt><dd><Pii value={p.email ?? t('admin.items.none')} /></dd>
        <dt>{t('admin.parties.address')}</dt>
        <dd>{address.length === 0 ? t('admin.items.none') : address.map((v, n) => <span key={n}>{n > 0 ? ', ' : null}<Pii value={v} /></span>)}</dd>
        <dt>{t('admin.parties.creditDays')}</dt><dd>{p.creditDays === null ? t('admin.parties.noCredit') : t('admin.parties.days', { n: String(p.creditDays) })}</dd>
        <dt>{t('admin.parties.creditLimit')}</dt><dd>{p.creditLimit === null ? t('admin.parties.noCredit') : formatMoney(p.creditLimit)}</dd>
        <dt>{t('admin.locations.col.status')}</dt><dd>{t(p.active ? 'admin.locations.active' : 'admin.locations.inactive')}</dd>
      </dl>

      <PartyPriceList partyId={p.id} partyName={p.name} />

      {mayWrite ? (
        <>
          <div className="kit-actions admin-choices">
            <button type="button" className="kit-button" onClick={() => setToggling(true)}>
              {t(p.active ? 'admin.locations.switchOff' : 'admin.locations.switchOn')}
            </button>
          </div>
          <h2 id="party-form">{t('admin.parties.edit')}</h2>
          {/* Keyed on the saved party, so after a save the form starts from what's saved. */}
          <Form key={JSON.stringify(p)} aria-labelledby="party-form" schema={editPartySchema} messages={PARTY_MESSAGES}
            saved={t('admin.parties.saved')}
            defaultValues={{
              name: p.name, kinds: p.kinds, gstin: p.gstin ?? '', pan: p.pan ?? '', stateCode: p.stateCode, composition: p.composition, overseas: p.overseas,
              phone: plain(p.phone), email: plain(p.email), addressLine1: plain(p.addressLine1), addressLine2: plain(p.addressLine2),
              city: plain(p.city), pincode: plain(p.pincode),
              // A masked contact field holds the server's { masked }, which MaskedField shows and the form never sends.
            } as unknown as z.input<typeof editPartySchema>}
            onSubmit={(v) => save.submit({ id: p.id, ...v })}>
            <PartyFields />
            <SubmitButton>{t('admin.parties.save')}</SubmitButton>
          </Form>
          <ConfirmDialog open={toggling} onOpenChange={setToggling}
            title={t(p.active ? 'admin.parties.switchOff.title' : 'admin.parties.switchOn.title', { name: p.name })}
            body={t(p.active ? 'admin.parties.switchOff.body' : 'admin.parties.switchOn.body')}
            action={t(p.active ? 'admin.locations.switchOff' : 'admin.locations.switchOn')}
            done={t(p.active ? 'admin.parties.switchedOff' : 'admin.parties.switchedOn', { name: p.name })}
            onConfirm={async () => { await save.submit({ id: p.id, active: !p.active }); }} />
        </>
      ) : null}

      {mayManage ? (
        <>
          <h2 id="credit-form">{t('admin.parties.credit')}</h2>
          <p>{t('admin.parties.credit.hint')}</p>
          <Form key={`${p.creditDays}-${p.creditLimit}`} aria-labelledby="credit-form" schema={creditSchema} messages={MESSAGES}
            saved={t('admin.parties.credit.saved')}
            defaultValues={{ creditDays: p.creditDays === null ? '' : String(p.creditDays), creditLimit: p.creditLimit ?? '', reason: '' }}
            onSubmit={(v) => setCredit.submit({ id: p.id, ...v })}>
            <TextField name="creditDays" label={t('admin.parties.creditDays')} hint={t('admin.parties.creditDays.hint')} inputMode="numeric" autoComplete="off" />
            <TextField name="creditLimit" label={t('admin.parties.creditLimit.field')} hint={t('admin.parties.creditLimit.hint')} inputMode="decimal" autoComplete="off" />
            <TextAreaField name="reason" label={t('admin.reason')} />
            <SubmitButton>{t('admin.parties.credit.save')}</SubmitButton>
          </Form>
        </>
      ) : null}
    </>
  );
}
