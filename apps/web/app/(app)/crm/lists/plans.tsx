'use client';
// Follow-up plans (RAD-122 on RAD-109's contracts): a name and its steps, each so many days after the one before, with
// what to do. A plan is rewritten whole, and a lead on it takes its next step as the plan now reads (the server's rule).
// Switched off, never deleted.
import { createPlan, getLeadLists, updatePlan } from '@radcore/lib-crm/contract';
import { useId, useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu } from '../../../../components/ui/dialog/menu.tsx';
import { CheckboxField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { CRM_MESSAGES } from '../shared.ts';
import { inUse, wholeList, type ListsQuery } from './whole-list.ts';

type Plan = z.output<typeof getLeadLists.output>['plans'][number];
const later = (text: string) => setTimeout(() => announce(text), 0);
const stepShape = createPlan.input.shape.steps.element.shape;

const step = z.object({
  // 1 to 365 as the contract takes it, worded here so its own range message never shows.
  afterDays: z.string().trim().regex(/^(36[0-5]|3[0-5]\d|[12]\d\d|[1-9]\d?)$/, t('crm.plans.afterDays.bad')).transform(Number)
    .pipe(stepShape.afterDays),
  note: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(stepShape.note),
});
const planSchema = z.object({
  name: createPlan.input.shape.name,
  steps: z.array(step).min(1, t('crm.plans.stepsMin')).max(20, t('crm.plans.stepsMax')),
  active: z.boolean(),
});
type PlanInput = z.input<typeof planSchema>;
const blankStep = { afterDays: '1', note: '' };

function Steps() {
  const { control } = useFormContext<PlanInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'steps' });
  return (
    <>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('crm.plans.step', { n: String(i + 1) })}</legend>
          <TextField name={`steps.${i}.afterDays`} label={t('crm.plans.afterDays')} hint={i === 0 ? t('crm.plans.afterDays.hint') : undefined}
            inputMode="numeric" autoComplete="off" />
          <TextField name={`steps.${i}.note`} label={t('crm.plans.note')} autoComplete="off" />
          {fields.length > 1 ? (
            <button type="button" className="kit-button" onClick={() => remove(i)}>{t('crm.plans.removeStep', { n: String(i + 1) })}</button>
          ) : null}
        </fieldset>
      ))}
      {fields.length < 20 ? <button type="button" className="kit-button" onClick={() => append(blankStep)}>{t('crm.plans.addStep')}</button> : null}
    </>
  );
}

export function Plans({ q, mayWrite }: { q: ListsQuery; mayWrite: boolean }) {
  const headingId = useId();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const close = (open: boolean) => { if (!open) setEditing(null); };
  const create = useApiMutation(createPlan, { invalidates: [getLeadLists] });
  const update = useApiMutation(updatePlan, { invalidates: [getLeadLists] });
  const columns: Column<Plan>[] = [
    { id: 'name', header: t('crm.plans.name'), cell: (p) => p.name },
    { id: 'steps', header: t('crm.plans.steps'), cell: (p) => t('crm.plans.stepCount', { n: String(p.steps.length) }) },
    { id: 'status', header: t('crm.col.status'), cell: (p) => inUse(p.active) },
    ...(mayWrite ? [{ id: 'actions', header: t('admin.users.col.actions'), cell: (p: Plan) => (
      <Menu label={t('crm.actionsFor', { name: p.name })} items={[{ label: t('crm.edit'), onSelect: () => setEditing(p) }]} />
    ) }] : []),
  ];
  const initial: PlanInput = editing === null || editing === 'new' ? { name: '', steps: [blankStep], active: true } : {
    name: editing.name, active: editing.active,
    steps: editing.steps.map((s) => ({ afterDays: String(s.afterDays), note: s.note ?? '' })),
  };
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('crm.plans.title')}</h2>
      <p>{t('crm.plans.intro')}</p>
      {mayWrite ? <button type="button" className="kit-button" onClick={() => setEditing('new')}>{t('crm.plans.add')}</button> : null}
      <DataTable caption={t('crm.plans.title')} columns={columns} rowKey={(p) => p.id} list={wholeList(q, (l) => l.plans)}
        empty={t('crm.plans.empty')} />
      <Dialog open={editing !== null} onOpenChange={close} title={t(editing === 'new' ? 'crm.plans.add' : 'crm.plans.edit')}>
        {editing === null ? null : (
          <Form schema={planSchema} saved={false} messages={CRM_MESSAGES} defaultValues={initial}
            onSubmit={async ({ active, ...plan }) => {
              if (editing === 'new') await create.submit(plan);
              else await update.submit({ id: editing.id, active, ...plan });
              setEditing(null);
              later(t(editing === 'new' ? 'crm.plans.added' : 'crm.plans.saved'));
            }}>
            <TextField name="name" label={t('crm.plans.name')} autoComplete="off" />
            <Steps />
            {editing === 'new' ? null : <CheckboxField name="active" label={t('crm.inUse')} hint={t('crm.inUse.hint')} />}
            <div className="kit-actions">
              <CloseButton>{t('crm.cancel')}</CloseButton>
              <SubmitButton>{t(editing === 'new' ? 'crm.add' : 'crm.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>
    </section>
  );
}
