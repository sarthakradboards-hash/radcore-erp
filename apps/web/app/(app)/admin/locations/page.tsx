'use client';
// Locations (RAD-99 on RAD-92's contracts): the places stock can be, a page at a time, and the names their kinds show.
// locations:read sees them; locations:write adds, edits and switches them off or on (never deletes: ADR-005 §3) and
// renames a kind's label. The kinds themselves are lib-common's fixed list; only their labels change.
import {
  addLocation, listLocationKinds, listLocations, setLocationKindLabel, updateLocation,
} from '@radcore/lib-stock/contract';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu, type MenuItem } from '../../../../components/ui/dialog/menu.tsx';
import { RadioField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons, ConfirmDialog, MESSAGES } from '../shared.tsx';
import type { LocationKindInfo as Kind, StockLocation as Location } from '../types.ts';
type Show = 'all' | 'active' | 'inactive';
type Acting = { kind: 'add' } | { kind: 'edit' | 'toggle'; location: Location } | { kind: 'label'; of: Kind };

const later = (text: string) => setTimeout(() => announce(text), 0);
const locationSchema = addLocation.input;
// An empty label puts the kind's default back (the contract's null).
const labelSchema = z.object({ label: z.string().trim().max(40) });

export default function LocationsPage() {
  const mayWrite = useMe().permissions.includes('locations:write');
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('active');
  const list = useApiList(listLocations, {
    filter: { ...(search === '' ? {} : { search }), ...(show === 'all' ? {} : { status: show }) },
  });
  const kinds: Kind[] = useApiQuery(listLocationKinds, {}).data?.kinds ?? [];
  const label = (kind: Location['kind']) => kinds.find((k) => k.kind === kind)?.label ?? kind;
  const kindOptions = kinds.map((k) => ({
    value: k.kind, label: k.label, detail: t(k.sellable ? 'admin.locations.sellable' : 'admin.locations.notSellable'),
  }));

  const [acting, setActing] = useState<Acting | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const refresh = { invalidates: [listLocations, listLocationKinds] };
  const add = useApiMutation(addLocation, refresh);
  const update = useApiMutation(updateLocation, refresh);
  const rename = useApiMutation(setLocationKindLabel, refresh);

  const actions = (l: Location): MenuItem[] => [
    { label: t('admin.locations.edit'), onSelect: () => setActing({ kind: 'edit', location: l }) },
    { label: t(l.active ? 'admin.locations.switchOff' : 'admin.locations.switchOn'), onSelect: () => setActing({ kind: 'toggle', location: l }) },
  ];
  const columns: Column<Location>[] = [
    { id: 'code', header: t('admin.locations.col.code'), cell: (l) => l.code },
    { id: 'name', header: t('admin.locations.col.name'), cell: (l) => l.name },
    { id: 'kind', header: t('admin.locations.col.kind'), cell: (l) => label(l.kind) },
    { id: 'status', header: t('admin.locations.col.status'), cell: (l) => t(l.active ? 'admin.locations.active' : 'admin.locations.inactive') },
    ...(mayWrite ? [{ id: 'actions', header: t('admin.users.col.actions'),
      cell: (l: Location) => <Menu label={t('admin.locations.actionsFor', { code: l.code })} items={actions(l)} /> }] : []),
  ];

  const editing = acting?.kind === 'edit' || acting?.kind === 'toggle' ? acting.location : undefined;
  const kindBeingRenamed = acting?.kind === 'label' ? acting.of : undefined;
  return (
    <>
      <h1>{t('admin.locations.title')}</h1>
      <p>{t('admin.locations.intro')}</p>
      <div className="admin-toolbar">
        <SearchBox label={t('admin.locations.search')} action={t('admin.audit.apply')} onSearch={setSearch} />
        {mayWrite ? (
          <button type="button" className="kit-button kit-button-primary" onClick={() => setActing({ kind: 'add' })}>
            {t('admin.locations.add')}
          </button>
        ) : null}
      </div>
      <ChoiceButtons<Show> label={t('admin.locations.col.status')} value={show} onChange={setShow} options={[
        { value: 'active', label: t('admin.locations.active') }, { value: 'inactive', label: t('admin.locations.inactive') },
        { value: 'all', label: t('admin.locations.all') },
      ]} />
      <DataTable caption={t('admin.locations.title')} columns={columns} rowKey={(l) => l.id} list={list}
        empty={t('admin.locations.empty')} />

      <h2 id="kinds-title">{t('admin.locations.kinds')}</h2>
      <p>{t('admin.locations.kinds.intro')}</p>
      <ul aria-labelledby="kinds-title" className="admin-kinds">
        {kinds.map((k) => (
          <li key={k.kind}>
            <span>{k.label}</span>
            <span className="kit-field-hint">{t(k.sellable ? 'admin.locations.sellable' : 'admin.locations.notSellable')}</span>
            {mayWrite ? (
              <button type="button" className="kit-button" aria-label={t('admin.locations.rename.label', { kind: k.label })}
                onClick={() => setActing({ kind: 'label', of: k })}>{t('admin.locations.rename')}</button>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog open={acting?.kind === 'add'} onOpenChange={close} title={t('admin.locations.add')}>
        <Form schema={locationSchema} defaultValues={{ code: '', name: '', kind: kinds[0]?.kind ?? 'store' }} saved={false}
          messages={MESSAGES} onSubmit={async (v) => {
            await add.submit(v);
            setActing(null);
            later(t('admin.locations.added', { code: v.code }));
          }}>
          <TextField name="code" label={t('admin.locations.col.code')} hint={t('admin.locations.code.hint')} autoComplete="off" />
          <TextField name="name" label={t('admin.locations.col.name')} autoComplete="off" />
          <RadioField name="kind" label={t('admin.locations.col.kind')} options={kindOptions} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.locations.add')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <Dialog open={acting?.kind === 'edit'} onOpenChange={close} title={t('admin.locations.edit.title', { code: editing?.code ?? '' })}>
        {editing === undefined ? null : (
          <Form schema={locationSchema} defaultValues={{ code: editing.code, name: editing.name, kind: editing.kind }}
            saved={false} messages={MESSAGES} onSubmit={async (v) => {
              await update.submit({ id: editing.id, ...v });
              setActing(null);
              later(t('admin.locations.saved', { code: v.code }));
            }}>
            <TextField name="code" label={t('admin.locations.col.code')} hint={t('admin.locations.code.hint')} autoComplete="off" />
            <TextField name="name" label={t('admin.locations.col.name')} autoComplete="off" />
            <RadioField name="kind" label={t('admin.locations.col.kind')} options={kindOptions} />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('admin.locations.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>

      <ConfirmDialog open={acting?.kind === 'toggle'} onOpenChange={close}
        title={t(editing?.active === true ? 'admin.locations.switchOff.title' : 'admin.locations.switchOn.title', { code: editing?.code ?? '' })}
        body={t(editing?.active === true ? 'admin.locations.switchOff.body' : 'admin.locations.switchOn.body')}
        action={t(editing?.active === true ? 'admin.locations.switchOff' : 'admin.locations.switchOn')}
        done={t(editing?.active === true ? 'admin.locations.switchedOff' : 'admin.locations.switchedOn', { code: editing?.code ?? '' })}
        onConfirm={async () => { if (editing !== undefined) await update.submit({ id: editing.id, active: !editing.active }); }} />

      <Dialog open={acting?.kind === 'label'} onOpenChange={close}
        title={t('admin.locations.rename.label', { kind: kindBeingRenamed?.label ?? '' })} description={t('admin.locations.rename.hint')}>
        {kindBeingRenamed === undefined ? null : (
          <Form schema={labelSchema} defaultValues={{ label: kindBeingRenamed.label }} saved={false} messages={MESSAGES}
            onSubmit={async ({ label: typed }) => {
              await rename.submit({ kind: kindBeingRenamed.kind, label: typed === '' ? null : typed });
              setActing(null);
              later(t('admin.locations.renamed'));
            }}>
            <TextField name="label" label={t('admin.locations.rename.field')} autoComplete="off" />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('admin.locations.rename')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>
    </>
  );
}
