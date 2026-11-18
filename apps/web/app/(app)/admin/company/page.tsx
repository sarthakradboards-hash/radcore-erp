'use client';
// The company profile (RAD-99 on RAD-88's contracts): what every invoice prints about the seller. One record, set
// whole (D-02: there is no second company). company:read sees it; company:write sets it, with a reason. The state
// comes from the GSTIN, so the server answers it and the screen only shows it. Nothing is invoiced until it's set.
import { getCompany, setCompany } from '@radcore/lib-accounts/contract';
import { stateName } from '@radcore/lib-common';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { MESSAGES } from '../shared.tsx';

// The second address line is optional: an empty box is sent as null, as the contract holds it.
const schema = setCompany.input.extend({ addressLine2: z.string().trim().max(200) });

export default function CompanyPage() {
  const q = useApiQuery(getCompany, {});
  const save = useApiMutation(setCompany, { invalidates: [getCompany] });
  const mayWrite = useMe().permissions.includes('company:write');
  const company = q.data?.company;

  return (
    <>
      <h1 id="company-title">{t('admin.company.title')}</h1>
      <p>{t('admin.company.intro')}</p>
      {q.error === null ? null : (
        <div role="alert" className="kit-form-alert">
          {t('error.title')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      )}
      {q.data === undefined ? (q.error === null ? <p>{t('loading')}</p> : null) : (
        <>
          {company === null ? <p role="note" className="admin-notice">{t('admin.company.unset')}</p> : null}
          {company === null || company === undefined ? null : (
            <dl className="admin-facts" aria-label={t('admin.company.title')}>
              <dt>{t('admin.company.legalName')}</dt><dd>{company.legalName}</dd>
              <dt>{t('admin.company.gstin')}</dt><dd>{company.gstin}</dd>
              <dt>{t('admin.company.state')}</dt><dd>{stateName(company.stateCode) ?? company.stateCode} ({company.stateCode})</dd>
              <dt>{t('admin.company.address')}</dt>
              <dd>{[company.addressLine1, company.addressLine2, `${company.city} ${company.pincode}`].filter(Boolean).join(', ')}</dd>
            </dl>
          )}
          {mayWrite ? (
            <>
              <h2 id="company-form">{t(company === null ? 'admin.company.set' : 'admin.company.change')}</h2>
              {/* Keyed on the saved record, so the form starts from what's saved after each save. */}
              <Form key={JSON.stringify(company)} aria-labelledby="company-form" schema={schema} messages={MESSAGES}
                saved={t('admin.company.saved')}
                defaultValues={{
                  legalName: company?.legalName ?? '', gstin: company?.gstin ?? '',
                  addressLine1: company?.addressLine1 ?? '', addressLine2: company?.addressLine2 ?? '',
                  city: company?.city ?? '', pincode: company?.pincode ?? '', reason: '',
                }}
                onSubmit={({ addressLine2, ...v }) => save.submit({ ...v, addressLine2: addressLine2 === '' ? null : addressLine2 })}>
                <TextField name="legalName" label={t('admin.company.legalName')} autoComplete="organization" />
                <TextField name="gstin" label={t('admin.company.gstin')} hint={t('admin.company.gstin.hint')}
                  autoComplete="off" autoCapitalize="characters" spellCheck={false} />
                <TextField name="addressLine1" label={t('admin.company.addressLine1')} autoComplete="address-line1" />
                <TextField name="addressLine2" label={t('admin.company.addressLine2')} autoComplete="address-line2" />
                <TextField name="city" label={t('admin.company.city')} autoComplete="address-level2" />
                <TextField name="pincode" label={t('admin.company.pincode')} inputMode="numeric" autoComplete="postal-code" />
                <TextAreaField name="reason" label={t('admin.reason')} />
                <SubmitButton>{t('admin.company.save')}</SubmitButton>
              </Form>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
