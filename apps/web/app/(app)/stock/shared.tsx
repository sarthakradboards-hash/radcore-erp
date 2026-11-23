'use client';
// What the stock screens share (RAD-144): the refusals in the screen's words, where a document is on its way, the places
// to choose from, a line's value at cost (masked without cost:read), and the dialogs to send, delete and cancel a
// document. The server holds every rule (who approves, what posts, what can be undone); the screens draw what it sends.
import { dateString, formatMoney, indiaDate, isMasked, reason, type Masked } from '@radcore/lib-common';
import { listLocations } from '@radcore/lib-stock/contract';
import { z } from 'zod';
import { CloseButton, Dialog } from '../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../components/ui/form/form.tsx';
import { announce } from '../../../components/ui/live-region.tsx';
import { Pii } from '../../../components/ui/masked.tsx';
import { useApiList } from '../../../lib/api/query.ts';
import { t } from '../../../lib/i18n/index.ts';

const CODES = ['unknown_location', 'location_inactive', 'unknown_item', 'quantity_too_precise', 'qty_not_positive', 'date_in_future',
  'counted_in_future', 'unknown_batch', 'serial_twice', 'not_serialised', 'serial_elsewhere', 'serial_unknown', 'chassis_required',
  'chassis_not_allowed', 'wrong_status', 'year_not_open', 'period_locked', 'account_inactive', 'not_enough_stock', 'batches_mismatch',
  'units_mismatch', 'unit_held', 'no_estimate', 'date_before_source', 'goods_moved_on', 'own_request', 'approver_too_new',
  'version_changed', 'not_pending', 'transfer_same_location', 'needs_qc', 'use_job_work', 'series_full', 'unknown_party', 'no_job_work_place', 'challan_answered',
  'charges_billed', 'unknown_challan', 'not_on_challan', 'over_challan', 'made_without_use', 'used_without_made'] as const;
/** The stock contracts' refusals in the screen's words, for Form's, ReasonDialog's and ConfirmDialog's `messages`. */
export const STOCK_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`stock.err.${c}`)]));

export type DocStatus = 'draft' | 'posted' | 'cancelled';
export const statusName = (s: DocStatus) => t(`stock.status.${s}`);
/** Drafted, then posted when approved; a cancelled one's bar runs on to Cancelled. */
export const docSteps = (status: DocStatus) => (status === 'cancelled' ? ['draft', 'posted', 'cancelled'] as const : ['draft', 'posted'] as const)
  .map((key) => ({ key, label: statusName(key) }));
export const numberText = (number: string | null) => number ?? t('stock.draft');

/** A line's value at cost: a mask for someone without cost:read, and nothing on a draft. */
export function Value({ x }: { x: string | null | Masked }) {
  if (x === null) return '';
  return isMasked(x) ? <Pii value={x} /> : formatMoney(x);
}

/** The places stock is kept: every active place, of any kind (a count or an adjustment can be at any). The first 200,
 * as the delivery form's; a draft's place is offered even if it can't be listed now, so it isn't lost.
 * shortcut: only the first 200 places, as the sales screens; a get-by-id is owed when a company has more (auditor-3 on #288). */
export function usePlaces(current: string) {
  const places = useApiList(listLocations, { filter: { status: 'active' } }, { limit: 200 });
  const options = places.items.map((l) => ({ value: l.id, label: l.name }));
  if (current !== '' && !options.some((o) => o.value === current)) options.push({ value: current, label: t('stock.place') });
  return options;
}

const cancelSchema = z.object({ businessDate: dateString(), reason: reason() });

/** Cancels a posted document: its mirror, on the date given, with a reason. stock:approve's; the server refuses the rest. */
export function CancelDocDialog({ open, onOpenChange, onCancel }: {
  open: boolean; onOpenChange: (open: boolean) => void; onCancel: (v: { businessDate: string; reason: string }) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('stock.cancelDialog.title')} description={t('stock.cancelDialog.body')}>
      <Form schema={cancelSchema} saved={false} messages={STOCK_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
        onSubmit={async (v) => { await onCancel(v); onOpenChange(false); setTimeout(() => announce(t('stock.cancelled')), 0); }}>
        <TextField name="businessDate" label={t('stock.cancelDialog.date')} type="date" />
        <TextAreaField name="reason" label={t('stock.reason')} hint={t('stock.reason.hint')} />
        <div className="kit-actions">
          <CloseButton>{t('stock.cancel')}</CloseButton>
          <SubmitButton>{t('stock.cancelDoc')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

/** One unit per line, as a found unit's serial and, after a comma, its chassis number. Blank lines are left out. */
export function unitsFromText(text: string): { serialNo: string; chassisNo: string | null }[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '').map((l) => {
    const [serial = '', chassis = ''] = l.split(',').map((p) => p.trim());
    return { serialNo: serial, chassisNo: chassis === '' ? null : chassis };
  });
}
/** One serial per line, blank lines left out. */
export const serialsFromText = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
