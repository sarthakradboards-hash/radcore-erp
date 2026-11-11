'use client';
// The one reason dialog for every cancel and reverse (M1-43, WEB-21). RC-134: v1 saved a made-up reason; here the
// action can't be sent until the person has typed their own, and that text is what is sent.
import { z } from 'zod';
import { announce } from '../live-region.tsx';
import { TextAreaField } from '../form/fields.tsx';
import { Form, SubmitButton } from '../form/form.tsx';
import { CloseButton, Dialog } from './dialog.tsx';
import { t } from '../../../lib/i18n/index.ts';

// Only "something typed"; the contract's own rules (length and the like) come back as an issue on `reason`.
const schema = z.object({ reason: z.string().trim().min(1, t('kit.reason.required')) });

type ReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being done to what: "Cancel invoice INV-0042". */
  title: string;
  /** The confirm button: "Cancel invoice". */
  action: string;
  /** Sends it, for example `cancel.submit({ id, reason })`. An ApiError's issue at ["reason"] shows on the field. */
  onConfirm: (reason: string) => Promise<unknown>;
  /** Said to screen readers once it is done: "Invoice cancelled". */
  done: string;
};

export function ReasonDialog({ open, onOpenChange, title, action, onConfirm, done }: ReasonDialogProps) {
  const confirm = async ({ reason }: z.output<typeof schema>) => {
    await onConfirm(reason);
    onOpenChange(false);
    // After the dialog is gone, so the page's live region, no longer inert, is the one that speaks.
    setTimeout(() => announce(done), 0);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <Form schema={schema} defaultValues={{ reason: '' }} onSubmit={confirm} saved={false}>
        <TextAreaField name="reason" label={t('kit.reason.label')} hint={t('kit.reason.hint')} />
        <div className="kit-actions">
          <CloseButton>{t('kit.reason.keep')}</CloseButton>
          <SubmitButton>{action}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}
