'use client';
// The pipeline board (RAD-122 on RAD-109's contracts): a column for each stage, each lead a card in its stage's column,
// latest enquiry first. A card is dragged to another column with the browser's own drag and drop, or, the way that works
// for everyone (keyboard, screen readers, touch), moved with its "Move to" menu (the kit's Radix menu). Lost asks for a
// reason. Every move is the server's moveLead; the board draws what it sends and words what it refuses. No new library
// (the coordinator on RAD-122). Phones are the server's last-4 mask, as on every lead list (RC-041).
import { LEAD_STAGES, getLeadLists, listLeads, moveLead } from '@radcore/lib-crm/contract';
import Link from 'next/link';
import { useId, useRef, useState, type DragEvent } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu } from '../../../../components/ui/dialog/menu.tsx';
import { SelectField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { Pii } from '../../../../components/ui/masked.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { ApiError } from '../../../../lib/api-client.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { droppedId, LEAD_MESSAGES, leadName, ownerText, stageName, type Stage } from '../shared.ts';

type Lead = z.output<typeof listLeads.output>['items'][number];
type Whose = 'all' | 'me' | 'none';
const DRAG_TYPE = 'application/x-radcore-lead';

const lostSchema = z.object({ lostReasonId: z.string().min(1, t('crm.move.needsReason')).pipe(moveLead.input.shape.lostReasonId.unwrap()) });

/** Why a lead was lost, asked when it's moved to Lost. */
function LostDialog({ lead, onClose, onMoved }: { lead: Lead; onClose: () => void; onMoved: () => void }) {
  const reasons = useApiQuery(getLeadLists, {}).data?.lostReasons.filter((r) => r.active) ?? [];
  const move = useApiMutation(moveLead, { invalidates: [listLeads] });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('crm.board.lost.title', { name: leadName(lead.name, lead.phone) })}
      description={t('crm.move.body')}>
      <Form schema={lostSchema} saved={false} messages={LEAD_MESSAGES} defaultValues={{ lostReasonId: '' }}
        onSubmit={async (v) => { await move.submit({ id: lead.id, stage: 'lost', lostReasonId: v.lostReasonId }); onMoved(); }}>
        <SelectField name="lostReasonId" label={t('crm.move.reason')} placeholder={t('crm.move.reason.pick')}
          options={reasons.map((r) => ({ value: r.id, label: r.label }))} />
        <div className="kit-actions"><CloseButton>{t('crm.cancel')}</CloseButton><SubmitButton>{t('crm.move.save')}</SubmitButton></div>
      </Form>
    </Dialog>
  );
}

type Props = {
  meId: string; mayWrite: boolean; onMove: (lead: Lead, to: Stage) => void;
  /** The card this page is dragging: kept on drag start, taken (and cleared) by the drop. */
  onDrag: (lead: Lead) => void; takeDragged: () => Lead | null;
};

/** After a move, once the lists have refetched and drawn, focus follows the card to its new column, or that column's
 * heading while the card isn't on its first page, so a keyboard user isn't dropped back at the top (e2e-2 on #358). */
const focusMoved = (id: string, stage: Stage) => requestAnimationFrame(() => {
  const column = document.querySelector(`[data-stage="${stage}"]`);
  (column?.querySelector<HTMLElement>(`[data-lead="${id}"] a`) ?? column?.querySelector<HTMLElement>('h2'))?.focus();
});

function Card({ lead, meId, mayWrite, onMove, onDrag }: { lead: Lead } & Props) {
  const name = leadName(lead.name, lead.phone);
  return (
    <li className="crm-card" draggable={mayWrite} data-lead={lead.id}
      onDragStart={(e) => {
        onDrag(lead);
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: lead.id }));
        e.dataTransfer.effectAllowed = 'move';
      }}>
      <p className="crm-list-head"><Link href={`/crm/leads/${lead.id}`}>{name}</Link></p>
      <p><Pii value={lead.phone} /></p>
      <p className="kit-field-hint">{ownerText(lead.owner, meId)}</p>
      {mayWrite ? (
        <Menu label={t('crm.board.moveFor', { name })} items={LEAD_STAGES.filter((s) => s !== lead.stage)
          .map((s) => ({ label: t('crm.board.moveTo', { stage: stageName(s) }), onSelect: () => onMove(lead, s) }))} />
      ) : null}
    </li>
  );
}

function Column({ stage, whose, ...props }: { stage: Stage; whose: Whose } & Props) {
  const headingId = useId();
  const list = useApiList(listLeads, { filter: { stage, ...(whose === 'all' ? {} : { owner: whose }) } }, { limit: 50 });
  const { mayWrite, onMove, takeDragged } = props;
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    // The lead comes from the card this page started dragging, never from the drop's data, which any page could send.
    const lead = takeDragged();
    if (lead !== null && lead.id === droppedId(e.dataTransfer.getData(DRAG_TYPE)) && lead.stage !== stage) onMove(lead, stage);
  };
  return (
    <section aria-labelledby={headingId} className="crm-column" data-stage={stage} data-over={over || undefined}
      onDragOver={(e) => { if (mayWrite && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)} onDrop={drop}>
      <h2 id={headingId} tabIndex={-1}>{stageName(stage)}</h2>
      {list.error !== null ? <p role="alert" className="kit-form-alert">{t('error.title')}</p>
        : list.isPending ? <p>{t('loading')}</p>
        : list.items.length === 0 ? <p>{t('crm.board.empty')}</p> : (
          <ol className="crm-list">{list.items.map((l) => <Card key={l.id} lead={l} {...props} />)}</ol>
        )}
      {list.hasNextPage ? (
        <button type="button" className="kit-button" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{t('crm.board.more')}</button>
      ) : null}
    </section>
  );
}

export default function LeadBoardPage() {
  const me = useMe();
  const mayWrite = me.permissions.includes('leads:write');
  const [whose, setWhose] = useState<Whose>('all');
  const [lost, setLost] = useState<Lead | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dragged = useRef<Lead | null>(null);
  const move = useApiMutation(moveLead, { invalidates: [listLeads] });
  const onMove = (lead: Lead, to: Stage) => {
    setProblem(null);
    if (to === 'lost') { setLost(lead); return; }
    move.submit({ id: lead.id, stage: to }).then(
      () => { focusMoved(lead.id, to); announce(t('crm.board.moved', { name: leadName(lead.name, lead.phone), stage: stageName(to) })); },
      (e: unknown) => setProblem(e instanceof ApiError ? LEAD_MESSAGES[e.code] ?? e.message : t('error.title')),
    );
  };
  return (
    <>
      <h1>{t('crm.board.title')}</h1>
      <p>{t('crm.board.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Whose> label={t('crm.leads.whose')} value={whose} onChange={setWhose} options={[
          { value: 'all', label: t('crm.leads.whose.all') }, { value: 'me', label: t('crm.leads.whose.mine') },
          { value: 'none', label: t('crm.leads.whose.none') },
        ]} />
      </div>
      {problem === null ? null : <p role="alert" className="kit-form-alert">{problem}</p>}
      <div className="crm-board">
        {LEAD_STAGES.map((s) => <Column key={s} stage={s} whose={whose} meId={me.user.id} mayWrite={mayWrite} onMove={onMove}
          onDrag={(l) => { dragged.current = l; }} takeDragged={() => { const l = dragged.current; dragged.current = null; return l; }} />)}
      </div>
      {lost === null ? null : (
        <LostDialog lead={lost} onClose={() => setLost(null)}
          onMoved={() => {
            const l = lost;
            setLost(null);
            // After the dialog has handed focus back to the menu button, which the move takes off the board.
            setTimeout(() => { focusMoved(l.id, 'lost'); announce(t('crm.board.moved', { name: leadName(l.name, l.phone), stage: stageName('lost') })); }, 0);
          }} />
      )}
    </>
  );
}
