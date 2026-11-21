'use client';
// The buyer's invoice as it was issued (CGST Rule 46): the issuer and the buyer in full, the place of supply, each line with its
// GST, the totals, and a unit's condition when it isn't new. The contract leaves out everything else personal and every cost, so
// the screen shows what it is given and works nothing out. Each opening is logged by the server; the page is read once and not
// refetched on focus or reconnect, so a tab left open doesn't count as more looks.
import { dec, formatDate, formatMoney, stateName } from '@radcore/lib-common';
import { viewInvoiceLink } from '@radcore/lib-sales/contract';
import { useId, useSyncExternalStore } from 'react';
import { takeLinkToken } from '../../../../components/auth/link-token.ts';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../../(app)/admin/decimal.ts';
import '../../../../components/ui/table/table.css';
import './invoice.css';

type View = NonNullable<ReturnType<typeof useApiQuery<typeof viewInvoiceLink>>['data']>;

// Taking the token clears it from the address bar, so it is taken once per link and remembered until another link arrives: pasting a
// second link into the same tab changes only the fragment (no reload), and `hashchange` is how the page hears of it. A fragment
// that holds no usable token is a bad link, not the previous invoice again.
let taken: string | null | undefined;
function linkToken(): string | null | undefined {
  if (typeof window === 'undefined') return undefined;
  if (taken === undefined || window.location.hash !== '') taken = takeLinkToken();
  return taken;
}
const subscribe = (notify: () => void) => {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
};

const money = (x: string | null) => (x === null ? '' : formatMoney(x));
const address = (parts: readonly (string | null)[]) => parts.filter((p): p is string => p !== null && p !== '').join(', ');

function Lines({ v }: { v: View }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{t('sales.public.lines')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('sales.public.col.item')}</th>
              <th scope="col">{t('sales.public.col.hsn')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.qty')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.rate')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.discount')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.taxable')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.gst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.cgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.sgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.igst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.public.col.total')}</th>
            </tr>
          </thead>
          <tbody>
            {v.lines.map((l) => (
              <tr key={l.lineNo}>
                <td>
                  {l.name} ({l.sku})
                  {l.unitCondition === null ? null : <><br /><small>{t(`sales.public.condition.${l.unitCondition}`)}</small></>}
                </td>
                <td>{l.hsn ?? ''}</td>
                <td className="kit-numeric">{asWritten(l.qty)} {l.unit}</td>
                <td className="kit-numeric">{asPrice(l.rate)}</td>
                <td className="kit-numeric">{asWritten(l.discountPercent)}</td>
                <td className="kit-numeric">{money(l.taxable)}</td>
                <td className="kit-numeric">{l.gstRate === null ? '' : asWritten(l.gstRate)}</td>
                <td className="kit-numeric">{money(l.cgst)}</td>
                <td className="kit-numeric">{money(l.sgst)}</td>
                <td className="kit-numeric">{money(l.igst)}</td>
                <td className="kit-numeric">{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Invoice({ v }: { v: View }) {
  const { issuer, buyer, shipTo } = v;
  const totals: [string, string][] = [
    [t('sales.amounts.taxable'), formatMoney(v.taxable)], [t('sales.amounts.cgst'), formatMoney(v.cgst)],
    [t('sales.amounts.sgst'), formatMoney(v.sgst)], [t('sales.amounts.igst'), formatMoney(v.igst)],
    ...(dec(v.cess).isZero() ? [] : [[t('sales.invoice.cess'), formatMoney(v.cess)] as [string, string]]),
    [t('sales.amounts.roundOff'), formatMoney(v.roundOff)], [t('sales.amounts.total'), formatMoney(v.total)],
  ];
  return (
    <>
      <h1>{t('sales.public.title.number', { number: v.number })}</h1>
      <p>{t('sales.public.note')}</p>
      <section className="public-invoice-parties">
        <div>
          <h2>{t('sales.public.issuer')}</h2>
          <p><strong>{issuer.legalName}</strong><br />{t('sales.public.gstin', { gstin: issuer.gstin })}<br />
            {address([issuer.addressLine1, issuer.addressLine2, issuer.city, issuer.pincode])}{', '}{stateName(issuer.stateCode) ?? issuer.stateCode}</p>
        </div>
        <div>
          <h2>{t('sales.public.buyer')}</h2>
          <p><strong>{buyer.name}</strong><br />
            {buyer.gstin === null ? t('sales.public.unregistered') : t('sales.public.gstin', { gstin: buyer.gstin })}<br />
            {address([buyer.addressLine1, buyer.addressLine2, buyer.city, buyer.pincode])}{', '}{stateName(buyer.stateCode) ?? buyer.stateCode}</p>
        </div>
        {shipTo === null ? null : (
          <div>
            <h2>{t('sales.public.shipTo')}</h2>
            <p><strong>{shipTo.name}</strong><br />{shipTo.address}{', '}{stateName(shipTo.stateCode) ?? shipTo.stateCode}</p>
          </div>
        )}
      </section>
      <dl className="public-invoice-facts">
        <dt>{t('sales.public.date')}</dt><dd>{formatDate(v.businessDate)}</dd>
        {v.placeOfSupply === null ? null : <><dt>{t('sales.public.place')}</dt><dd>{stateName(v.placeOfSupply) ?? v.placeOfSupply}</dd></>}
      </dl>
      <Lines v={v} />
      <section aria-labelledby="public-totals">
        <h2 id="public-totals">{t('sales.public.totals')}</h2>
        <dl className="public-invoice-facts">
          {totals.map(([label, value]) => <div key={label} className="public-invoice-total"><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>
      <p className="public-invoice-print"><button type="button" className="kit-button" onClick={() => window.print()}>{t('sales.public.print')}</button></p>
    </>
  );
}

export function InvoiceView() {
  const token = useSyncExternalStore(subscribe, linkToken, () => undefined);
  // Read once: a refetch (focus, reconnect, a remount) would log another opening, and the invoice as issued doesn't change.
  const q = useApiQuery(viewInvoiceLink, { token: token ?? '' }, { enabled: typeof token === 'string', staleTime: Infinity });
  if (token === undefined) return <p role="status">{t('sales.public.loading')}</p>;
  if (token === null || q.error !== null) return <p role="alert">{t('sales.public.bad')}</p>;
  if (q.data === undefined) return <p role="status">{t('sales.public.loading')}</p>;
  return <Invoice v={q.data} />;
}
