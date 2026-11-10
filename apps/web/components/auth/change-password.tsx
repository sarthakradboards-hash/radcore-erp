'use client';
// Changing your own password while signed in (M1-45). It ends your other sessions and keeps this one (M1-16); the
// answer says how many, so the person knows other devices were signed out. Password forms never autosave (RAD-55).
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@radcore/lib-common';
import { changePassword } from '@radcore/lib-platform/contract';
import { useState } from 'react';
import { useApiMutation } from '../../lib/api/query.ts';
import { t } from '../../lib/i18n/index.ts';
import { Form, SubmitButton } from '../ui/form/form.tsx';
import { TextField } from '../ui/form/fields.tsx';

/** @public sign-in screen API: its first caller is the account page (app/(app)/account/password). */
export function ChangePassword() {
  const [ended, setEnded] = useState<number | null>(null);
  const change = useApiMutation(changePassword);
  return (
    <>
      {ended !== null ? <p role="status">{t('password.changed', { count: String(ended) })}</p> : null}
      <Form schema={changePassword.input} defaultValues={{ currentPassword: '', newPassword: '' }} saved={t('password.changedShort')}
        aria-labelledby="page-title"
        onSubmit={async (values) => setEnded((await change.submit(values)).otherSessionsEnded)}>
        <TextField name="currentPassword" label={t('password.current')} type="password" autoComplete="current-password"
          maxLength={PASSWORD_MAX_LENGTH} />
        <TextField name="newPassword" label={t('password.new')} type="password" autoComplete="new-password"
          hint={t('password.rule', { min: String(PASSWORD_MIN_LENGTH) })} maxLength={PASSWORD_MAX_LENGTH} />
        <SubmitButton>{t('password.change')}</SubmitButton>
      </Form>
    </>
  );
}
