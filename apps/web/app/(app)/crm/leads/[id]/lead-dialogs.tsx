'use client';
// What can be done to a lead (RAD-122 on RAD-109's contracts), each in its own dialog: a follow-up, a move to a stage,
// a follow-up plan, a quick reply, its details, and handing it on. The server judges each (claiming an unowned lead,
// stages, plans, who may hand one on); a dialog only words what it says.
import { formatDate, isMasked } from '@radcore/lib-common';
import {
  assignLead, followUpLead, getLead, getLeadLists, LEAD_STAGES, listLeads, moveLead, planLead, quickReply, updateLead,
} from '@radcore/lib-crm/contract';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { MaskedField, RadioField, SelectField, TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { LEAD_MESSAGES, stageName } from '../../shared.ts';

type Lead = z.output<typeof getLead.output>;
type Lists = z.output<typeof getLeadLists.output>;
type Open = { open: boolean; onOpenChange: (open: boolean) => void };

const later = (text: string) => setTimeout(() => announce(text), 0);
/** An empty box means none given: the contract takes the field left out, not an empty string. */
const emptyIsLeftOut = <T extends z.ZodType<unknown, string | undefined>>(inner: T) =>
  z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(inner);
/** An empty box clears the field: the contract takes null for that. */
const emptyIsNull = <T extends z.ZodType<unknown, string | null>>(inner: T) =>
  z.string().trim().transform((s) => (s === '' ? null : s)).pipe(inner);
const refresh = [getLead, listLeads];

function Actions({ save }: { save: string }) {
  return (
    <div className="kit-actions">
      <CloseButton>{t('crm.cancel')}</CloseButton>
      <SubmitButton>{save}</SubmitButton>
    </div>
  );
}

const followUpShape = followUpLead.input.shape;
const followUpSchema = z.object({ note: emptyIsLeftOut(followUpShape.note), nextOn: emptyIsLeftOut(followUpShape.nextOn) });

export function FollowUpDialog({ id, open, onOpenChange }: { id: string } & Open) {
  const followUp = useApiMutation(followUpLead, { invalidates: refresh });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('crm.followUp.title')} description={t('crm.followUp.body')}>
      <Form schema={followUpSchema} saved={false} messages={LEAD_MESSAGES} defaultValues={{ note: '', nextOn: '' }}
        onSubmit={async (v) => {
          const { followUpOn } = await followUp.submit({ id, ...v });
          onOpenChange(false);
          later(followUpOn === null ? t('crm.followUp.doneNone') : t('crm.followUp.done', { date: formatDate(followUpOn) }));
        }}>
        <TextAreaField name="note" label={t('crm.followUp.note')} />
        <TextField name="nextOn" label={t('crm.followUp.nextOn')} type="date" />
        <Actions save={t('crm.followUp.save')} />
      </Form>
    </Dialog>
  );
}

const moveShape = moveLead.input.shape;
const moveSchema = z.object({ stage: moveShape.stage, lostReasonId: emptyIsLeftOut(moveShape.lostReasonId), note: emptyIsLeftOut(moveShape.note) })
  .refine((v) => v.stage !== 'lost' || v.lostReasonId !== undefined, { path: ['lostReasonId'], error: t('crm.move.needsReason') });

/** The lost reason box, only while Lost is chosen: no other stage takes one. */
function LostReason({ reasons }: { reasons: Lists['lostReasons'] }) {
  const stage = useWatch({ control: useFormContext().control, name: 'stage' }) as unknown;
  if (stage !== 'lost') return null;
  return (
    <SelectField name="lostReasonId" label={t('crm.move.reason')} placeholder={t('crm.move.reason.pick')}
      options={reasons.filter((r) => r.active).map((r) => ({ value: r.id, label: r.label }))} />
  );
}

export function MoveDialog({ lead, lists, open, onOpenChange }: { lead: Lead; lists: Lists } & Open) {
  const move = useApiMutation(moveLead, { invalidates: refresh });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('crm.move.title')} description={t('crm.move.body')}>
      <Form schema={moveSchema} saved={false} messages={LEAD_MESSAGES} defaultValues={{ stage: lead.stage, lostReasonId: '', note: '' }}
        onSubmit={async (v) => {
          await move.submit({ id: lead.id, ...v });
          onOpenChange(false);
          later(t('crm.move.done', { stage: stageName(v.stage) }));
        }}>
        <RadioField name="stage" label={t('crm.stage')} options={LEAD_STAGES.map((s) => ({ value: s, label: stageName(s) }))} />
        <LostReason reasons={lists.lostReasons} />
        <TextAreaField name="note" label={t('crm.move.note')} />
        <Actions save={t('crm.move.save')} />
      </Form>
    </Dialog>
  );
}

const planSchema = z.object({ planId: emptyIsNull(planLead.input.shape.planId) });

export function PlanDialog({ lead, lists, open, onOpenChange }: { lead: Lead; lists: Lists } & Open) {
  const plan = useApiMutation(planLead, { invalidates: refresh });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('crm.planDialog.title')} description={t('crm.planDialog.body')}>
      <Form schema={planSchema} saved={false} messages={LEAD_MESSAGES} defaultValues={{ planId: lead.planId ?? '' }}
        onSubmit={async (v) => {
          const { followUpOn } = await plan.submit({ id: lead.id, ...v });
          onOpenChange(false);
          later(v.planId === null || followUpOn === null ? t('crm.planDialog.doneOff') : t('crm.planDialog.done', { date: formatDate(followUpOn) }));
        }}>
        <SelectField name="planId" label={t('crm.planDialog.plan')} options={[
          { value: '', label: t('crm.planDialog.off') },
          ...lists.plans.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })),
        ]} />
        <Actions save={t('crm.planDialog.save')} />
      </Form>
    </Dialog>
  );
}

const replySchema = z.object({ replyId: z.string().min(1, t('crm.reply.pick')).pipe(quickReply.input.shape.replyId) });

/**
 * A quick reply's text, filled in for this lead by the server and kept on its timeline, to copy into a message.
 * shortcut: no "open in WhatsApp" link; that send waits for consent (RAD-108), then the text opens in WhatsApp.
 */
export function ReplyDialog({ id, lists, open, onOpenChange }: { id: string; lists: Lists } & Open) {
  const reply = useApiMutation(quickReply, { invalidates: refresh });
  const [text, setText] = useState<string | null>(null);
  const active = lists.quickReplies.filter((r) => r.active);
  const shut = (isOpen: boolean) => { if (!isOpen) setText(null); onOpenChange(isOpen); };
  return (
    <Dialog open={open} onOpenChange={shut} title={t('crm.reply.title')} description={t('crm.reply.body')}>
      {active.length === 0 ? <p>{t('crm.reply.noneActive')}</p> : (
        <Form schema={replySchema} saved={false} messages={LEAD_MESSAGES} defaultValues={{ replyId: '' }}
          onSubmit={async (v) => { setText((await reply.submit({ id, ...v })).text); }}>
          <SelectField name="replyId" label={t('crm.reply.pick')} placeholder={t('crm.reply.pick')}
            options={active.map((r) => ({ value: r.id, label: r.title }))} />
          <div className="kit-actions"><SubmitButton>{t('crm.reply.get')}</SubmitButton></div>
        </Form>
      )}
      {text === null ? null : (
        <section aria-label={t('crm.reply.text')}>
          {/* The server's text, shown as text: a reply's body is never markup. */}
          <p className="crm-reply-text">{text}</p>
          <button type="button" className="kit-button"
            onClick={() => void navigator.clipboard.writeText(text).then(() => announce(t('crm.reply.copied')), () => announce(t('crm.reply.copyFailed')))}>
            {t('crm.reply.copy')}
          </button>
        </section>
      )}
      <div className="kit-actions"><CloseButton>{t('crm.cancel')}</CloseButton></div>
    </Dialog>
  );
}

const editShape = updateLead.input.shape;
const editSchema = z.object({
  name: emptyIsNull(editShape.name.unwrap()),
  // Left out when this person sees it masked: the form never sends a mask back (ADR-001 §7a).
  email: emptyIsNull(editShape.email.unwrap()).optional(),
  value: emptyIsNull(editShape.value.unwrap()),
  // Whole numbers 0 to 100 as the contract takes them, worded here so its own range message never shows.
  score: z.string().trim().regex(/^(100|\d{1,2})?$/, t('crm.score.hint')).transform((s) => (s === '' ? null : Number(s)))
    .pipe(editShape.score.unwrap()),
  notes: emptyIsNull(editShape.notes.unwrap()),
  followUpOn: emptyIsNull(editShape.followUpOn.unwrap()),
});

export function EditDialog({ lead, open, onOpenChange }: { lead: Lead } & Open) {
  const update = useApiMutation(updateLead, { invalidates: refresh });
  const hidden = isMasked(lead.email);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('crm.edit.title')}>
      <Form schema={editSchema} saved={false} messages={LEAD_MESSAGES}
        defaultValues={{ name: lead.name ?? '', email: lead.email ?? '', value: lead.value ?? '',
          score: lead.score === null ? '' : String(lead.score), notes: lead.notes ?? '', followUpOn: lead.followUpOn ?? '',
          // A masked email holds the server's { masked }, which MaskedField shows and the form never sends (as the party form).
        } as unknown as z.input<typeof editSchema>}
        onSubmit={async (v) => {
          await update.submit({ id: lead.id, ...v });
          onOpenChange(false);
          later(t('crm.edit.done'));
        }}>
        <TextField name="name" label={t('crm.capture.name')} autoComplete="off" />
        {hidden ? <MaskedField name="email" label={t('crm.email')} hint={t('crm.edit.emailHidden')} />
          : <TextField name="email" label={t('crm.email')} type="email" autoComplete="off" />}
        <TextField name="value" label={t('crm.value')} inputMode="decimal" autoComplete="off" />
        <TextField name="score" label={t('crm.score')} hint={t('crm.score.hint')} inputMode="numeric" autoComplete="off" />
        <TextField name="followUpOn" label={t('crm.followUpOn')} type="date" />
        <TextAreaField name="notes" label={t('crm.notes')} />
        <Actions save={t('crm.edit.save')} />
      </Form>
    </Dialog>
  );
}

const assignSchema = z.object({ to: z.enum(['me', 'nobody']) });

/**
 * Hands a lead to this person or back to no one. Only someone who works every lead may: the server refuses the rest.
 * shortcut: no other people to pick until a list of who may hold leads exists (asked of backend-2 on RAD-122).
 */
export function AssignDialog({ id, meId, open, onOpenChange }: { id: string; meId: string } & Open) {
  const assign = useApiMutation(assignLead, { invalidates: refresh });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('crm.assign.title')} description={t('crm.assign.body')}>
      <Form schema={assignSchema} saved={false} messages={LEAD_MESSAGES} defaultValues={{ to: 'me' }}
        onSubmit={async (v) => {
          await assign.submit({ id, owner: v.to === 'me' ? meId : null });
          onOpenChange(false);
          later(t('crm.assign.done'));
        }}>
        <RadioField name="to" label={t('crm.owner')} options={[
          { value: 'me', label: t('crm.assign.me') }, { value: 'nobody', label: t('crm.assign.nobody') },
        ]} />
        <Actions save={t('crm.action.assign')} />
      </Form>
    </Dialog>
  );
}
