'use client';
// Changing a setting (RAD-133 on RAD-132's contract): a value in the form its kind asks for, and why. The server checks
// the value (invalid_value lands on the field, value_refused says why in the form's alert) and who may (settings:write,
// which it grants only with the second factor); null puts the setting back to its default. A change takes effect from
// the next request, and what's already posted keeps what it decided (ADR-001 §8c).
import { listSettings, setSetting } from '@radcore/lib-platform/contract';
import { listPriceLists } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { z } from 'zod';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { Picker } from '../../../../components/ui/picker/picker.tsx';
import { useApiMutation, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../decimal.ts';
import { MESSAGES } from '../shared.tsx';
import type { PriceList, Setting } from './types.ts';

const reason = setSetting.input.shape.reason;
const schema = z.object({ value: z.union([z.string(), z.boolean()]), reason });
const referenceSchema = z.object({ reason });
const later = (text: string) => setTimeout(() => announce(text), 0);

/** The value as the box starts: what's stored, written as a person would. */
function startValue(s: Setting): string | boolean {
  const v = s.value;
  if (s.input.kind === 'yes_no') return v === true;
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  if (s.input.kind === 'money') return asPrice(String(v));
  if (s.input.kind === 'percent') return asWritten(String(v));
  return String(v);
}

/** What the server is sent for what the box holds: an integer setting takes a number. */
const sent = (s: Setting, v: string | boolean): string | number | boolean => (s.input.kind === 'integer' && typeof v === 'string' ? Number(v) : v);

/** A reference setting's record, chosen with the kit's Picker (only the default price list is one so far). */
function ReferenceForm({ setting, onSave }: { setting: Setting; onSave: (id: string | null, why: string) => Promise<unknown> }) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<PriceList | null>(null);
  const found = useApiSearch(listPriceLists, query, { params: { filter: { status: 'active' } } });
  return (
    <Form schema={referenceSchema} saved={false} messages={MESSAGES} defaultValues={{ reason: '' }}
      onSubmit={({ reason: why }) => onSave(list === null ? null : list.id, why)}>
      <Picker label={setting.label} hint={t('admin.settings.reference.hint')} query={query} onQueryChange={setQuery}
        options={found.items} loading={found.isFetching} error={found.error} value={list} onChange={setList}
        optionKey={(l) => l.id} optionLabel={(l) => l.name} optionDetail={() => null} />
      <TextAreaField name="reason" label={t('admin.reason')} />
      <div className="kit-actions">
        <CloseButton>{t('admin.cancel')}</CloseButton>
        <SubmitButton>{t('admin.settings.save')}</SubmitButton>
      </div>
    </Form>
  );
}

export function EditSetting({ setting, onClose }: { setting: Setting | null; onClose: () => void }) {
  const save = useApiMutation(setSetting, { invalidates: [listSettings] });
  const saved = (name: string) => { onClose(); later(t('admin.settings.saved', { name })); };
  const input = setting?.input;
  return (
    <Dialog open={setting !== null} onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('admin.settings.change.title', { name: setting?.label ?? '' })} description={t('admin.settings.change.body')}>
      {setting === null || input === undefined ? null : input.kind === 'reference' ? (
        <ReferenceForm setting={setting} onSave={async (id, why) => { await save.submit({ key: setting.key, value: id, reason: why }); saved(setting.label); }} />
      ) : (
        <Form schema={schema} saved={false} messages={MESSAGES} defaultValues={{ value: startValue(setting), reason: '' }}
          onSubmit={async (v) => { await save.submit({ key: setting.key, value: sent(setting, v.value), reason: v.reason }); saved(setting.label); }}>
          {input.kind === 'yes_no' ? <CheckboxField name="value" label={setting.label} hint={setting.description} />
            : input.kind === 'choice' ? (
              <SelectField name="value" label={setting.label} hint={setting.description} options={input.choices} placeholder={t('admin.settings.choose')} />
            ) : (
              <TextField name="value" label={setting.label} hint={setting.description} autoComplete="off"
                inputMode={input.kind === 'money' || input.kind === 'percent' ? 'decimal' : input.kind === 'integer' ? 'numeric' : 'text'} />
            )}
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.settings.save')}</SubmitButton>
          </div>
        </Form>
      )}
    </Dialog>
  );
}

/** Back to the default: the same save with null, and a reason. */
export function ResetSetting({ setting, onClose }: { setting: Setting | null; onClose: () => void }) {
  const save = useApiMutation(setSetting, { invalidates: [listSettings] });
  return (
    <ReasonDialog open={setting !== null} onOpenChange={(open) => { if (!open) onClose(); }} messages={MESSAGES}
      title={t('admin.settings.reset.title', { name: setting?.label ?? '' })} action={t('admin.settings.reset')}
      done={t('admin.settings.resetDone', { name: setting?.label ?? '' })}
      onConfirm={(why) => save.submit({ key: setting?.key ?? '', value: null, reason: why })} />
  );
}
