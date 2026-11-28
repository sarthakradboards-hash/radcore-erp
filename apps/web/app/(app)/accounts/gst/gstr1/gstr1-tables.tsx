'use client';
// GSTR-1's tables (RAD-169 on RAD-154's getGstr1; ADR-010 §3), each read-only, as the server built them. A document table
// shows a row per rate with the document's fields on its first row (byRate). Nothing is added up or worked out here.
import { formatDate, formatMoney, stateName } from '@radcore/lib-common';
import type { getGstr1 } from '@radcore/lib-gst/contract';
import { useId, type ReactNode } from 'react';
import type { z } from 'zod';
import { t, type MessageKey } from '../../../../../lib/i18n/index.ts';
import '../../../../../components/ui/table/table.css';
import { asWritten } from '../../../admin/decimal.ts';
import { byRate } from './gstr1-rows.ts';

type Gstr1 = z.output<typeof getGstr1.output>;
type Tax = Pick<Gstr1['table7'][number], 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess'>;
type Col = { label: MessageKey; numeric?: boolean };
type Row = { key: string; cells: ReactNode[] };

const TAX_COLS: Col[] = [
  { label: 'gst.r1.col.taxable', numeric: true }, { label: 'gst.r1.col.igst', numeric: true }, { label: 'gst.r1.col.cgst', numeric: true },
  { label: 'gst.r1.col.sgst', numeric: true }, { label: 'gst.r1.col.cess', numeric: true },
];
const taxCells = (x: Tax | null) =>
  x === null ? ['', '', '', '', ''] : [x.taxable, x.igst, x.cgst, x.sgst, x.cess].map((m) => formatMoney(m));
const rate = (r: string) => `${asWritten(r)}%`;
const place = (code: string) => `${stateName(code) ?? code} (${code})`;
const KINDS = ['nil', 'exempt', 'non_gst'] as const;
const kindName = (k: string) => (KINDS as readonly string[]).includes(k) ? t(`gst.r1.kind.${k as (typeof KINDS)[number]}`) : k;

function ReturnTable({ caption, cols, rows }: { caption: MessageKey; cols: readonly Col[]; rows: readonly Row[] }) {
  const id = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={id} tabIndex={0}>
        <table>
          <caption id={id}>{t(caption)}</caption>
          <thead>
            <tr>{cols.map((c) => <th key={c.label} scope="col" className={c.numeric ? 'kit-numeric' : undefined}>{t(c.label)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={cols.length}>{t('gst.r1.none')}</td></tr> : rows.map((r) => (
              <tr key={r.key}>{r.cells.map((c, i) => <td key={i} className={cols[i]?.numeric ? 'kit-numeric' : undefined}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A document table: the document's own columns, then the rate and its tax. */
function DocTable<D extends { number: string | null; date: string; value: string; placeOfSupply: string; items: readonly (Tax & { rate: string })[] }>(
  { caption, docCols, docCells, docs }: { caption: MessageKey; docCols: readonly Col[]; docCells: (d: D) => ReactNode[]; docs: readonly D[] },
) {
  const cols: Col[] = [...docCols, { label: 'gst.r1.col.number' }, { label: 'gst.r1.col.date' }, { label: 'gst.r1.col.value', numeric: true },
    { label: 'gst.r1.col.pos' }, { label: 'gst.r1.col.rate', numeric: true }, ...TAX_COLS];
  const rows = byRate(docs).map(({ key, doc, item, first }) => ({ key, cells: [
    ...(first ? [...docCells(doc), doc.number ?? '', formatDate(doc.date), formatMoney(doc.value), place(doc.placeOfSupply)]
      : [...docCols.map(() => ''), '', '', '', '']),
    item === null ? '' : rate(item.rate), ...taxCells(item),
  ] }));
  return <ReturnTable caption={caption} cols={cols} rows={rows} />;
}

const NOTE_COLS: Col[] = [{ label: 'gst.r1.col.gstin' }, { label: 'gst.r1.col.invoice' }];
const noteCells = (n: Gstr1['table9b']['cdnr'][number]) => [n.buyerGstin ?? '', `${n.invoiceNumber ?? ''}, ${formatDate(n.invoiceDate)}`];

export function Gstr1Tables({ r }: { r: Gstr1 }) {
  const hsn = (part: 'b2b' | 'b2c') => r.table12.filter((h) => h.part === part).map((h, i) => ({ key: `${part}-${i}`,
    cells: [h.hsn, h.uqc, asWritten(h.qty), rate(h.rate), ...taxCells(h)] }));
  const hsnCols: Col[] = [{ label: 'gst.r1.col.hsn' }, { label: 'gst.r1.col.uqc' }, { label: 'gst.r1.col.qty', numeric: true },
    { label: 'gst.r1.col.rate', numeric: true }, ...TAX_COLS];
  return (
    <>
      <DocTable caption="gst.r1.t4a" docCols={[{ label: 'gst.r1.col.gstin' }]} docCells={(d) => [d.buyerGstin]} docs={r.table4a} />
      <DocTable caption="gst.r1.t4c" docCols={[{ label: 'gst.r1.col.gstin' }, { label: 'gst.r1.col.operator' }]}
        docCells={(d) => [d.buyerGstin, d.ecommerceGstin]} docs={r.table4c} />
      <DocTable caption="gst.r1.t5" docCols={[]} docCells={() => []} docs={r.table5} />
      <ReturnTable caption="gst.r1.t7" cols={[{ label: 'gst.r1.col.pos' }, { label: 'gst.r1.col.rate', numeric: true }, { label: 'gst.r1.col.operator' }, ...TAX_COLS]}
        rows={r.table7.map((x, i) => ({ key: String(i), cells: [place(x.placeOfSupply), rate(x.rate), x.ecommerceGstin ?? '', ...taxCells(x)] }))} />
      <ReturnTable caption="gst.r1.t8" cols={[{ label: 'gst.r1.col.supply' }, { label: 'gst.r1.col.buyer' }, { label: 'gst.r1.col.kind' },
        { label: 'gst.r1.col.value', numeric: true }]}
        rows={r.table8.map((x, i) => ({ key: String(i), cells: [t(`gst.r1.supply.${x.supply}`), t(`gst.r1.buyer.${x.buyer}`), kindName(x.kind), formatMoney(x.value)] }))} />
      <DocTable caption="gst.r1.cdnr" docCols={NOTE_COLS} docCells={noteCells} docs={r.table9b.cdnr} />
      <DocTable caption="gst.r1.cdnur" docCols={NOTE_COLS} docCells={noteCells} docs={r.table9b.cdnur} />
      <h2>{t('gst.r1.t11')}</h2>
      <p>{t('gst.r1.t11.none')}</p>
      <ReturnTable caption="gst.r1.t12b2b" cols={hsnCols} rows={hsn('b2b')} />
      <ReturnTable caption="gst.r1.t12b2c" cols={hsnCols} rows={hsn('b2c')} />
      <ReturnTable caption="gst.r1.t13" cols={[{ label: 'gst.r1.col.docType' }, { label: 'gst.r1.col.series' }, { label: 'gst.r1.col.from' },
        { label: 'gst.r1.col.to' }, { label: 'gst.r1.col.count', numeric: true }, { label: 'gst.r1.col.cancelled', numeric: true }]}
        rows={r.table13.map((x, i) => ({ key: String(i), cells: [x.documentType, x.series, x.from, x.to, String(x.count), String(x.cancelled)] }))} />
      <ReturnTable caption="gst.r1.t14" cols={[{ label: 'gst.r1.col.operator' }, ...TAX_COLS]}
        rows={r.table14.map((x, i) => ({ key: String(i), cells: [x.ecommerceGstin, ...taxCells(x)] }))} />
    </>
  );
}
