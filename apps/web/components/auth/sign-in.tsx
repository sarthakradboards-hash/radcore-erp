'use client';
// Signing in (M1-45): the password, then for admin and owner (D-19) the authenticator code, a recovery code instead,
// or first-time enrolment with its QR code and one-time recovery codes. The same steps serve the sign-in page and
// the signed-out dialog; only what happens at the end differs. Sign-in, verify and enrolment confirm send no retry
// key (ADR-001 §7a); enrolment start does, and its answer is never stored (storesAnswer: false).
import { PASSWORD_MAX_LENGTH } from '@radcore/lib-common';
import {
  confirmSecondFactorEnrolment, signIn, startSecondFactorEnrolment, verifySecondFactor,
} from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, callContract } from '../../lib/api-client.ts';
import { t } from '../../lib/i18n/index.ts';
import { Form, SubmitButton } from '../ui/form/form.tsx';
import { TextField } from '../ui/form/fields.tsx';
import { EnrolmentQr } from './enrolment-qr.tsx';
import { safeNext } from './safe-next.ts';

/** The sign-in page's flow: at the end, a full page load to where the person was going, if that's on this site. */
export function SignInPage() {
  const leave = () => window.location.assign(
    safeNext(new URLSearchParams(window.location.search).get('next'), window.location.origin));
  return <SignIn onDone={leave} labelledBy="auth-title" showReset />;
}

type Step = 'password' | 'second_factor' | 'enrol' | 'codes';

const [totpForm, recoveryForm] = verifySecondFactor.input.options.map((o) => o.pick({ code: true }));

type SignInProps = {
  onDone: () => void;
  /** The heading that names the forms; left out in a dialog, whose title names them. */
  labelledBy?: string;
  /** The "forgot your password" link: on the page only, since in the signed-out dialog it would leave the page. */
  showReset?: boolean;
};

/** Signs in, step by step, then calls `onDone` with the session cookie set. */
export function SignIn({ onDone, labelledBy, showReset = false }: SignInProps) {
  const aria = labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy };
  const [step, setStep] = useState<Step>('password');
  const [notice, setNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);

  // The pending sign-in ran out between steps: back to the password, saying why.
  const restartIfExpired = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'sign_in_expired') {
      setNotice(t('signIn.expired'));
      setStep('password');
      return;
    }
    throw e;
  };

  if (step === 'password') {
    return (
      <>
        {notice ? <p role="status" className="auth-notice">{notice}</p> : null}
        <Form schema={signIn.input} defaultValues={{ email: '', password: '' }} saved={false} {...aria}
          onSubmit={async (values) => {
            const answer = await callContract(signIn, values);
            setNotice(null);
            if (answer.next === 'done') onDone();
            else setStep(answer.next === 'second_factor' ? 'second_factor' : 'enrol');
          }}>
          <TextField name="email" label={t('signIn.email')} type="email" autoComplete="username" />
          <TextField name="password" label={t('signIn.password')} type="password" autoComplete="current-password" maxLength={PASSWORD_MAX_LENGTH} />
          <SubmitButton>{t('signIn.submit')}</SubmitButton>
        </Form>
        {showReset ? <p><Link href="/password-reset">{t('signIn.forgot')}</Link></p> : null}
      </>
    );
  }

  if (step === 'second_factor') {
    return (
      <>
        {recovery
          ? (
            <Form key="recovery" schema={recoveryForm!} defaultValues={{ code: '' }} saved={false} {...aria}
              onSubmit={async ({ code }) => {
                try { await callContract(verifySecondFactor, { kind: 'recovery', code }); } catch (e) { restartIfExpired(e); return; }
                onDone();
              }}>
              <TextField name="code" label={t('signIn.recoveryCode')} hint={t('signIn.recoveryHint')} autoComplete="off" spellCheck={false} />
              <SubmitButton>{t('signIn.verify')}</SubmitButton>
            </Form>
          )
          : (
            <Form key="totp" schema={totpForm!} defaultValues={{ code: '' }} saved={false} {...aria}
              onSubmit={async ({ code }) => {
                try { await callContract(verifySecondFactor, { kind: 'totp', code }); } catch (e) { restartIfExpired(e); return; }
                onDone();
              }}>
              <TextField name="code" label={t('signIn.totpCode')} hint={t('signIn.totpHint')} inputMode="numeric"
                autoComplete="one-time-code" maxLength={6} />
              <SubmitButton>{t('signIn.verify')}</SubmitButton>
            </Form>
          )}
        <button type="button" className="kit-button auth-switch" onClick={() => setRecovery(!recovery)}>
          {recovery ? t('signIn.useApp') : t('signIn.useRecovery')}
        </button>
      </>
    );
  }

  if (step === 'enrol') {
    return <Enrol aria={aria} onCodes={(c) => { setCodes(c); setStep('codes'); }} onExpired={restartIfExpired} />;
  }

  return (
    <div className="recovery-codes">
      <p>{t('signIn.codesIntro')}</p>
      <ol>{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
      <button type="button" className="kit-button kit-button-primary" onClick={onDone}>{t('signIn.codesSaved')}</button>
    </div>
  );
}

/** First-time enrolment: the QR code to scan, then the app's first code, which finishes signing in. */
function Enrol({ aria, onCodes, onExpired }:
  { aria: { 'aria-labelledby'?: string }; onCodes: (codes: string[]) => void; onExpired: (e: unknown) => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    // Once only: a second start would make a new secret and leave the first QR code wrong.
    if (started.current) return;
    started.current = true;
    callContract(startSecondFactorEnrolment, {}, { idempotencyKey: crypto.randomUUID() })
      .then((a) => setUri(a.otpauthUri))
      .catch((e: unknown) => { try { onExpired(e); } catch { setFailed(true); } });
  }, [onExpired]);
  if (failed) return <p role="alert">{t('error.offline')}</p>;
  if (uri === null) return <p role="status">{t('loading')}</p>;
  return (
    <>
      <p>{t('signIn.enrolIntro')}</p>
      <EnrolmentQr uri={uri} />
      <Form schema={confirmSecondFactorEnrolment.input} defaultValues={{ code: '' }} saved={false} {...aria}
        onSubmit={async (values) => {
          let answer;
          try { answer = await callContract(confirmSecondFactorEnrolment, values); } catch (e) { onExpired(e); return; }
          onCodes(answer.recoveryCodes);
        }}>
        <TextField name="code" label={t('signIn.totpCode')} hint={t('signIn.totpHint')} inputMode="numeric"
          autoComplete="one-time-code" maxLength={6} />
        <SubmitButton>{t('signIn.enrolConfirm')}</SubmitButton>
      </Form>
    </>
  );
}
