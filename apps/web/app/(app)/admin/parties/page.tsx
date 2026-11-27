'use client';
// Parties (RAD-99 on RAD-90's contracts): everyone RadCore sells to or buys from, a page at a time, searched by name
// or GSTIN and filtered by kind and by in use or switched off. Contact details show masked to a person without
// parties:contact (RAD-40's <Pii>). parties:write adds a party (then opens it); its page edits it and sets credit.
import { createParty, listParties, PARTY_KINDS } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { Pii } from '../../../../components/ui/masked.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../shared.tsx';
import type { Party } from '../types.ts';
import { kindsText, newPartySchema, PARTY_MESSAGES, PartyFields, partyStateName } from './party-fields.tsx';

type Kind = (typeof PARTY_KINDS)[number];
type Show = 'active' | 'inactive' | 'all';

const columns: Column<Party>[] = [
  { id: 'name', header: t('admin.parties.name'), cell: (p) => <Link href={`/admin/parties/${p.id}`}>{p.name}</Link> },
  { id: 'kinds', header: t('admin.parties.kinds'), cell: (p) => kindsText(p.kinds) },
  { id: 'gstin', header: t('admin.parties.gstin'), cell: (p) => p.gstin ?? t('admin.parties.unregistered') },
  { id: 'state', header: t('admin.parties.state'), cell: (p) => partyStateName(p.stateCode) },
  { id: 'phone', header: t('admin.parties.phone'), cell: (p) => <Pii value={p.phone ?? ''} /> },
  { id: 'city', header: t('admin.parties.city'), cell: (p) => <Pii value={p.city ?? ''} /> },
  { id: 'status', header: t('admin.locations.col.status'), cell: (p) => t(p.active ? 'admin.locations.active' : 'admin.locations.inactive') },
];

export default function PartiesPage() {
  const mayWrite = useMe().permissions.includes('parties:write');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [show, setShow] = useState<Show>('active');
  const list = useApiList(listParties, { filter: {
    ...(search === '' ? {} : { search }), ...(kind === 'all' ? {} : { kind }), ...(show === 'all' ? {} : { active: show === 'active' }),
  } });
  const [adding, setAdding] = useState(false);
  const add = useApiMutation(createParty, { invalidates: [listParties] });
  const router = useRouter();

  return (
    <>
      <h1>{t('admin.parties.title')}</h1>
      <p>{t('admin.parties.intro')}</p>
      <div className="admin-toolbar">
        <SearchBox label={t('admin.parties.search')} action={t('admin.audit.apply')} onSearch={setSearch} />
        {mayWrite ? (
          <button type="button" className="kit-button kit-button-primary" onClick={() => setAdding(true)}>{t('admin.parties.add')}</button>
        ) : null}
      </div>
      <div className="admin-toolbar">
        <ChoiceButtons<Kind | 'all'> label={t('admin.parties.kinds')} value={kind} onChange={setKind} options={[
          { value: 'all', label: t('admin.locations.all') },
          ...PARTY_KINDS.map((k) => ({ value: k, label: t(`admin.parties.kind.${k}`) })),
        ]} />
        <ChoiceButtons<Show> label={t('admin.locations.col.status')} value={show} onChange={setShow} options={[
          { value: 'active', label: t('admin.locations.active') }, { value: 'inactive', label: t('admin.locations.inactive') },
          { value: 'all', label: t('admin.locations.all') },
        ]} />
      </div>
      <DataTable caption={t('admin.parties.title')} columns={columns} rowKey={(p) => p.id} list={list} empty={t('admin.parties.empty')} />

      <Dialog open={adding} onOpenChange={setAdding} title={t('admin.parties.add')} description={t('admin.parties.add.hint')}>
        <Form schema={newPartySchema} saved={false} messages={PARTY_MESSAGES}
          defaultValues={{ name: '', kinds: [], gstin: '', pan: '', stateCode: '', composition: false, overseas: false, phone: '', email: '',
            addressLine1: '', addressLine2: '', city: '', pincode: '' }}
          onSubmit={async (v) => {
            const { id } = await add.submit(v);
            setAdding(false);
            setTimeout(() => announce(t('admin.parties.added', { name: v.name })), 0);
            router.push(`/admin/parties/${id}`);
          }}>
          <PartyFields />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.parties.add')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
