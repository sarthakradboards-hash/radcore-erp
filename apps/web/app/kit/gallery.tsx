'use client';
// Fake saves stand in for the API: each answers the way a refusing route does, with the error envelope (ADR-001 §7a).
import { moneyString } from '@radcore/lib-common';
import { useState } from 'react';
import { z } from 'zod';
import { Dialog } from '../../components/ui/dialog/dialog.tsx';
import { Menu } from '../../components/ui/dialog/menu.tsx';
import { ReasonDialog } from '../../components/ui/dialog/reason-dialog.tsx';
import { MaskedField, TextAreaField, TextField } from '../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../components/ui/form/form.tsx';
import { ApiError } from '../../lib/api-client.ts';

const party = z.object({ name: z.string().min(1, 'Enter a name'), phone: z.string().optional(), limit: moneyString(),
  note: z.string() });

const refuse = (issues: { path: string[]; message: string }[]) => new ApiError(400, {
  code: 'invalid_input', message: 'Some of what was sent needs correcting', requestId: 'kit',
  issues: issues.map((i) => ({ ...i, code: 'custom' })),
});

export function Gallery() {
  const [sent, setSent] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  return (
    <main>
      <h1>UI kit</h1>

      <h2 id="party-form">Edit party</h2>
      <p>The name &quot;Taken&quot; is refused on the field; &quot;Elsewhere&quot; is refused on a field not on screen.</p>
      <Form aria-labelledby="party-form" schema={party}
        defaultValues={{ name: 'Asha Traders', phone: '••••••3210', limit: '50000.00', note: '' }}
        onSubmit={async (values) => {
          if (values.name === 'Taken') throw refuse([{ path: ['name'], message: 'Another party has this name' }]);
          if (values.name === 'Elsewhere') throw refuse([{ path: ['gstin'], message: 'The GSTIN is not valid' }]);
          setSent(JSON.stringify(values));
        }}>
        <TextField name="name" label="Name" autoComplete="off" />
        <MaskedField name="phone" label="Phone" hint="Hidden for your role." />
        <TextField name="limit" label="Credit limit (₹)" inputMode="decimal" />
        <TextAreaField name="note" label="Note" />
        <SubmitButton>Save party</SubmitButton>
      </Form>
      <p>Last sent: <output aria-label="Last sent">{sent}</output></p>

      <h2>Actions</h2>
      <Menu label="Actions for INV-0042" items={[
        { label: 'Cancel invoice', onSelect: () => setCancelling(true) },
        { label: 'Archive', onSelect: () => undefined, disabled: true },
        { label: 'Sign out (test)', onSelect: () => setSignedOut(true) },
      ]} />
      <ReasonDialog open={cancelling} onOpenChange={setCancelling} title="Cancel invoice INV-0042"
        action="Cancel invoice" done="Invoice cancelled"
        onConfirm={async (reason) => {
          if (reason === 'short') throw refuse([{ path: ['reason'], message: 'Give at least 10 characters' }]);
          setSent(JSON.stringify({ id: 'INV-0042', reason }));
        }} />
      <Dialog open={signedOut} onOpenChange={setSignedOut} title="You are signed out" dismissible={false}
        description="Sign in again to carry on. Nothing you typed is lost.">
        <button type="button" className="kit-button kit-button-primary" onClick={() => setSignedOut(false)}>Sign in again</button>
      </Dialog>
    </main>
  );
}
