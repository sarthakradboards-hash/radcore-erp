'use client';
// GSTR-1 for a month (RAD-169 on RAD-154's getGstr1; ADR-010 §3), under gst:returns. The month is in the address
// (?month=YYYY-MM) and starts on last month. The tables are the server's, built from the month's posted documents; this
// screen files nothing and adds nothing up. The portal file (RAD-163) and the filed mark (RAD-156) join it later.
import { indiaDate } from '@radcore/lib-common';
import { getGstr1 } from '@radcore/lib-gst/contract';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { lastMonth } from './gstr1-rows.ts';
import { Gstr1Tables } from './gstr1-tables.tsx';

function Gstr1() {
  const router = useRouter();
  const asked = useSearchParams().get('month');
  const valid = getGstr1.input.safeParse({ month: asked }).success;
  const month = asked !== null && valid ? asked : lastMonth(indiaDate(new Date()));
  const q = useApiQuery(getGstr1, { month });
  return (
    <>
      <Form key={month} schema={getGstr1.input} saved={false} defaultValues={{ month }}
        onSubmit={async (v) => { router.replace(`?month=${v.month}`); }}>
        <TextField name="month" label={t('gst.r1.month')} type="month" />
        <SubmitButton>{t('gst.r1.show')}</SubmitButton>
      </Form>
      {q.error !== null ? (
        <div role="alert" className="kit-form-alert">
          {t('error.title')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      ) : q.data === undefined ? <p>{t('loading')}</p> : <Gstr1Tables r={q.data} />}
    </>
  );
}

export default function Gstr1Page() {
  const may = useMe().permissions.includes('gst:returns');
  return (
    <>
      <h1>{t('gst.r1.title')}</h1>
      <p>{t('gst.r1.intro')}</p>
      {may ? <Suspense fallback={<p>{t('loading')}</p>}><Gstr1 /></Suspense> : <p>{t('gst.r1.cannot')}</p>}
    </>
  );
}
