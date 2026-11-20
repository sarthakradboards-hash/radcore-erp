'use client';
// The price list a party is sold from (RAD-99 on #254's contracts, ADR-007 §9): its own, or the default it takes
// (sales.default_price_list, set on the Settings screen). A party with neither needs approval on every priced line, so
// the page says so. prices:read sees it; prices:approve, which puts a list's prices in force for one party, chooses
// the list or puts the party back on the default, with a reason.
import { getPartyPriceList, getPriceList, listPriceLists, setPartyPriceList } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { ReasonDialog } from '../../../../../components/ui/dialog/reason-dialog.tsx';
import { TextAreaField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { Picker } from '../../../../../components/ui/picker/picker.tsx';
import { ApiError } from '../../../../../lib/api-client.ts';
import { useApiMutation, useApiQuery, useApiSearch } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { MESSAGES } from '../../shared.tsx';
import type { PriceList } from '../../types.ts';

const reason = setPartyPriceList.input.shape.reason;
const schema = z.object({ reason });
const LIST_MESSAGES = {
  ...MESSAGES, unknown_party: t('admin.parties.priceList.err.party'), unknown_price_list: t('admin.parties.priceList.err.list'),
};
const later = (text: string) => setTimeout(() => announce(text), 0);

export function PartyPriceList({ partyId, partyName }: { partyId: string; partyName: string }) {
  const { permissions } = useMe();
  const mayRead = permissions.includes('prices:read');
  const mayApprove = permissions.includes('prices:approve');
  const current = useApiQuery(getPartyPriceList, { partyId }, { enabled: mayRead });
  const listId = current.data?.priceListId ?? null;
  const nameQuery = useApiQuery(getPriceList, { id: listId ?? '' }, { enabled: listId !== null });
  const set = useApiMutation(setPartyPriceList, { invalidates: [getPartyPriceList] });
  const [choosing, setChoosing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PriceList | null>(null);
  const found = useApiSearch(listPriceLists, query, { params: { filter: { status: 'active' } } });
  const close = () => { setChoosing(false); setPicked(null); setQuery(''); };

  if (!mayRead || current.data === undefined) return null;
  const own = current.data.own;
  const text = listId === null ? t('admin.parties.priceList.none')
    : nameQuery.isError ? ''
    : t(own ? 'admin.parties.priceList.own' : 'admin.parties.priceList.default', { name: nameQuery.data?.name ?? t('loading') });

  return (
    <section aria-labelledby="party-price-list">
      <h2 id="party-price-list">{t('admin.parties.priceList')}</h2>
      {text === '' ? null : <p>{text}</p>}
      {mayApprove ? (
        <div className="kit-actions">
          <button type="button" className="kit-button" onClick={() => setChoosing(true)}>{t('admin.parties.priceList.choose')}</button>
          {own ? <button type="button" className="kit-button" onClick={() => setClearing(true)}>{t('admin.parties.priceList.useDefault')}</button> : null}
        </div>
      ) : null}

      <Dialog open={choosing} onOpenChange={(open) => { if (!open) close(); }}
        title={t('admin.parties.priceList.choose.title', { name: partyName })} description={t('admin.parties.priceList.choose.body')}>
        <Form schema={schema} saved={false} messages={LIST_MESSAGES} defaultValues={{ reason: '' }}
          onSubmit={async (v) => {
            if (picked === null) {
              throw new ApiError(400, { code: 'invalid_input', message: t('admin.parties.priceList.pick'), requestId: '', issues: [] });
            }
            await set.submit({ partyId, priceListId: picked.id, reason: v.reason });
            close();
            later(t('admin.parties.priceList.chosen', { name: picked.name }));
          }}>
          <Picker label={t('admin.parties.priceList')} query={query} onQueryChange={setQuery} options={found.items}
            loading={found.isFetching} error={found.error} value={picked} onChange={setPicked}
            optionKey={(l) => l.id} optionLabel={(l) => l.name} optionDetail={() => null} />
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.parties.priceList.save')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <ReasonDialog open={clearing} onOpenChange={setClearing} messages={LIST_MESSAGES}
        title={t('admin.parties.priceList.useDefault.title', { name: partyName })} action={t('admin.parties.priceList.useDefault')}
        done={t('admin.parties.priceList.cleared', { name: partyName })}
        onConfirm={(why) => set.submit({ partyId, priceListId: null, reason: why })} />
    </section>
  );
}
