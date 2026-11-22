'use client';
// A lead taken by hand or at the counter (RAD-122 on RAD-106's captureLead). A number that already has a lead joins it
// (RC-142): the server says so, and leaves out the lead's id when it isn't this person's to open, so the screen shows
// nothing of it.
import { captureLead, listLeads } from '@radcore/lib-crm/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { z } from 'zod';
import { RadioField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { CRM_MESSAGES } from '../../shared.ts';

const shape = captureLead.input.shape;
/** An empty box means none given: the contract takes the field left out, not an empty string. */
const emptyIsLeftOut = <T extends z.ZodType<unknown, string | undefined>>(inner: T) =>
  z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(inner);
const schema = z.object({ phone: shape.phone, name: emptyIsLeftOut(shape.name), email: emptyIsLeftOut(shape.email), source: shape.source });

export default function NewLeadPage() {
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('leads:write');
  const capture = useApiMutation(captureLead, { invalidates: [listLeads] });
  return (
    <>
      <p><Link href="/crm/leads">{t('crm.back')}</Link></p>
      <h1 id="new-lead">{t('crm.capture.title')}</h1>
      <p>{t('crm.capture.intro')}</p>
      {mayWrite ? null : <p className="admin-notice">{t('crm.capture.cannot')}</p>}
      <Form aria-labelledby="new-lead" schema={schema} saved={false} messages={CRM_MESSAGES}
        defaultValues={{ phone: '', name: '', email: '', source: 'manual' }}
        onSubmit={async (v) => {
          const { id, repeat } = await capture.submit(v);
          const said = !repeat ? t('crm.capture.added') : id === undefined ? t('crm.capture.joinedHidden') : t('crm.capture.joined');
          setTimeout(() => announce(said), 0);
          router.push(id === undefined ? '/crm/leads' : `/crm/leads/${id}`);
        }}>
        <TextField name="phone" label={t('crm.capture.phone')} hint={t('crm.capture.phone.hint')} type="tel" inputMode="tel" autoComplete="off" />
        <TextField name="name" label={t('crm.capture.name')} autoComplete="off" />
        <TextField name="email" label={t('crm.capture.email')} type="email" autoComplete="off" />
        <RadioField name="source" label={t('crm.capture.source')} options={[
          { value: 'manual', label: t('crm.capture.source.manual') }, { value: 'walk_in', label: t('crm.capture.source.walk_in') },
        ]} />
        <SubmitButton>{t('crm.capture.save')}</SubmitButton>
      </Form>
    </>
  );
}
