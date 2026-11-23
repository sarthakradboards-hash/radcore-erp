'use client';
// The website's enquiry form (RAD-122 on RAD-107's form door, submitEnquiry): a phone, and a name, email and message if
// they like, checked by Cloudflare Turnstile before anything is stored (RC-054: no captcha-less door). A campaign's link
// or QR code carries its token as ?c=, which only tags the enquiry (the architect on RAD-110). The answer says nothing
// about any lead, so the page says only that it was sent.
// Turnstile is drawn explicitly from its own script, which only this page's CSP allows (proxy.ts). The script is added
// by this bundle, so the policy's 'strict-dynamic' trusts it through our nonce; no inline script is needed.
import { submitEnquiry } from '@radcore/lib-crm/contract';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { TextAreaField, TextField } from '../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../components/ui/form/form.tsx';
import { useApiMutation } from '../../../lib/api/query.ts';
import { t } from '../../../lib/i18n/index.ts';

type Turnstile = {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void;
    'error-callback': () => void }) => string;
  reset: (id: string) => void;
};
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const shape = submitEnquiry.input.shape;
/** An empty box means none given: the contract takes the field left out. */
const emptyIsLeftOut = <T extends z.ZodType<unknown, string | undefined>>(inner: T) =>
  z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(inner);
const enquirySchema = z.object({
  phone: shape.phone, name: emptyIsLeftOut(shape.name), email: emptyIsLeftOut(shape.email), message: emptyIsLeftOut(shape.message),
  captcha: z.string().min(1, t('crm.public.captcha.needed')).pipe(shape.captcha),
});
const MESSAGES: Partial<Record<string, string>> = {
  captcha_failed: t('crm.public.err.captcha_failed'), rate_limited: t('crm.public.err.rate_limited'),
};

/** A campaign token from the link, as the contract takes it, or none (an unknown or ended one tags nothing). */
const campaignFrom = (c: string | null) => (c !== null && /^[A-Za-z0-9_-]{22}$/.test(c) ? c : undefined);

/** The Turnstile widget. It fills the form's hidden `captcha`, and is reset when a send fails, since a token is good once. */
function Captcha({ siteKey, resetKey }: { siteKey: string; resetKey: number }) {
  const { setValue } = useFormContext<{ captcha: string }>();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const draw = () => {
      const ts = (window as { turnstile?: Turnstile }).turnstile;
      if (ts === undefined || box.current === null || widget.current !== null) return;
      widget.current = ts.render(box.current, {
        sitekey: siteKey,
        callback: (token) => setValue('captcha', token, { shouldValidate: true }),
        'expired-callback': () => setValue('captcha', ''),
        'error-callback': () => setFailed(true),
      });
    };
    if ((window as { turnstile?: Turnstile }).turnstile !== undefined) { draw(); return; }
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = draw;
    script.onerror = () => setFailed(true);
    document.head.append(script);
  }, [siteKey, setValue]);
  useEffect(() => {
    const ts = (window as { turnstile?: Turnstile }).turnstile;
    if (resetKey > 0 && ts !== undefined && widget.current !== null) { ts.reset(widget.current); setValue('captcha', ''); }
  }, [resetKey, setValue]);
  return (
    <div>
      <div ref={box} />
      {failed ? <p role="alert" className="kit-form-alert">{t('crm.public.captcha.failedToLoad')}</p> : null}
    </div>
  );
}

/** The hidden token's own error line: the form shows a hidden field's issue nowhere else. */
function CaptchaError() {
  const { formState: { errors } } = useFormContext<{ captcha: string }>();
  const message = errors.captcha?.message;
  return message === undefined ? null : <p role="alert" className="kit-field-error">{message}</p>;
}

export function EnquiryForm({ siteKey }: { siteKey: string }) {
  const campaign = campaignFrom(useSearchParams().get('c'));
  const send = useApiMutation(submitEnquiry);
  const [sent, setSent] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  if (sent) return <p role="status" className="admin-notice">{t('crm.public.sent')}</p>;
  return (
    <Form aria-labelledby="enquiry-title" schema={enquirySchema} saved={false} messages={MESSAGES}
      defaultValues={{ phone: '', name: '', email: '', message: '', captcha: '' }}
      onSubmit={async (v) => {
        try {
          await send.submit({ ...v, ...(campaign === undefined ? {} : { campaign }) });
          setSent(true);
        } catch (e) {
          setResetKey((k) => k + 1); // a token is used once, sent or refused
          throw e;
        }
      }}>
      <TextField name="phone" label={t('crm.capture.phone')} hint={t('crm.capture.phone.hint')} type="tel" inputMode="tel" autoComplete="tel" />
      <TextField name="name" label={t('crm.capture.name')} autoComplete="name" />
      <TextField name="email" label={t('crm.capture.email')} type="email" autoComplete="email" />
      <TextAreaField name="message" label={t('crm.public.message')} />
      <Captcha siteKey={siteKey} resetKey={resetKey} />
      <CaptchaError />
      <SubmitButton>{t('crm.public.send')}</SubmitButton>
    </Form>
  );
}
