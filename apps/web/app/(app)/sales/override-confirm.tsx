'use client';
// An action the server's checks can stop (posting an invoice or a delivery, confirming an order): the dialog asks, runs it,
// and when the checks find issues (needs_override) shows what the server named and offers to ask for an override, which
// someone holding sales:override decides. The screen holds no check of its own; it words what the server says.
import { useState } from 'react';
import { z } from 'zod';
import { CloseButton, Dialog } from '../../../components/ui/dialog/dialog.tsx';
import { Form, SubmitButton } from '../../../components/ui/form/form.tsx';
import { announce } from '../../../components/ui/live-region.tsx';
import { ApiError } from '../../../lib/api-client.ts';
import { t } from '../../../lib/i18n/index.ts';
import { SALES_MESSAGES } from './shared.tsx';

const nothing = z.object({});
const later = (text: string) => setTimeout(() => announce(text), 0);

export function OverrideConfirm({ open, onOpenChange, title, body, action, overrideBody, overrideAction, onConfirm, onAskOverride }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; body: string; action: string;
  overrideBody: string; overrideAction: string;
  /** Runs the action; what it returns is said to screen readers. */
  onConfirm: () => Promise<string>;
  onAskOverride: () => Promise<string>;
}) {
  const [needsOverride, setNeedsOverride] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shut = (isOpen: boolean) => {
    if (!isOpen) { setNeedsOverride(false); setProblem(null); }
    onOpenChange(isOpen);
  };
  const ask = async () => {
    try {
      const said = await onAskOverride();
      shut(false);
      later(said);
    } catch (e) {
      setProblem(e instanceof ApiError ? SALES_MESSAGES[e.code] ?? e.message : t('error.title'));
    }
  };
  return (
    <Dialog open={open} onOpenChange={shut} title={title} description={body}>
      <Form schema={nothing} saved={false} messages={SALES_MESSAGES} defaultValues={{}}
        onSubmit={async () => {
          try {
            const said = await onConfirm();
            shut(false);
            later(said);
          } catch (e) {
            // The form shows what the server found; asking for an override is the way on from it.
            if (e instanceof ApiError && e.code === 'needs_override') setNeedsOverride(true);
            throw e;
          }
        }}>
        <div className="kit-actions">
          <CloseButton>{t('sales.cancel')}</CloseButton>
          <SubmitButton>{action}</SubmitButton>
        </div>
      </Form>
      {needsOverride ? (
        <div>
          <p>{overrideBody}</p>
          {problem === null ? null : <p role="alert" className="kit-form-alert">{problem}</p>}
          <button type="button" className="kit-button" onClick={() => void ask()}>{overrideAction}</button>
        </div>
      ) : null}
    </Dialog>
  );
}
