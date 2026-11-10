'use client';
// Setting a password from an emailed link (M1-45): accepting an invite, or a password reset. The token comes from the
// link's #fragment (takeLinkToken) and goes in the body (ADR-001 §7a). Neither starts a session (RAD-64): afterwards
// the person signs in. The 15-character rule is the server's (password_rejected, too_short), shown as a hint here.
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@radcore/lib-common';
import { acceptInvite, requestPasswordReset, resetPassword } from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { useApiMutation } from '../../lib/api/query.ts';
import { t } from '../../lib/i18n/index.ts';
import { Form, SubmitButton } from '../ui/form/form.tsx';
import { TextField } from '../ui/form/fields.tsx';
import { takeLinkToken } from './link-token.ts';

const LINKS = { invite: acceptInvite, reset: resetPassword } as const;

// Taking the token clears it from the address bar, so it happens once per page load and is remembered after that.
// shortcut: one token per page load; a second link opened in the same tab without a reload reuses the first.
let taken: string | null | undefined;
const linkToken = () => (taken === undefined ? (taken = takeLinkToken()) : taken);
const noSubscribe = () => () => undefined;

/** The password form for a link; `undefined` while the fragment hasn't been read yet (it only exists in the browser). */
export function SetPassword({ kind }: { kind: keyof typeof LINKS }) {
  const token = useSyncExternalStore(noSubscribe, linkToken, () => undefined);
  const [done, setDone] = useState(false);
  const save = useApiMutation(LINKS[kind]);

  if (token === undefined) return <p role="status">{t('loading')}</p>;
  if (token === null) {
    return (
      <p role="alert">
        {t(kind === 'invite' ? 'link.badInvite' : 'link.badReset')}{' '}
        {kind === 'reset' ? <Link href="/password-reset">{t('reset.again')}</Link> : null}
      </p>
    );
  }
  if (done) return <p role="status">{t('link.done')} <Link href="/sign-in">{t('signIn.title')}</Link></p>;
  return (
    <Form schema={LINKS[kind].input.pick({ password: true })} defaultValues={{ password: '' }} saved={t('link.done')}
      aria-labelledby="auth-title"
      onSubmit={async ({ password }) => { await save.submit({ token, password }); setDone(true); }}>
      <TextField name="password" label={t('password.new')} type="password" autoComplete="new-password"
        hint={t('password.rule', { min: String(PASSWORD_MIN_LENGTH) })} maxLength={PASSWORD_MAX_LENGTH} />
      <SubmitButton>{t('password.set')}</SubmitButton>
    </Form>
  );
}

/** Asks for a reset link. The same answer for any address, so the form never says whether an account exists. */
export function RequestReset() {
  const [sent, setSent] = useState(false);
  const request = useApiMutation(requestPasswordReset);
  if (sent) return <p role="status">{t('reset.sent')}</p>;
  return (
    <Form schema={requestPasswordReset.input} defaultValues={{ email: '' }} saved={t('reset.sent')} aria-labelledby="auth-title"
      onSubmit={async (values) => { await request.submit(values); setSent(true); }}>
      <TextField name="email" label={t('signIn.email')} type="email" autoComplete="username" />
      <SubmitButton>{t('reset.send')}</SubmitButton>
    </Form>
  );
}
