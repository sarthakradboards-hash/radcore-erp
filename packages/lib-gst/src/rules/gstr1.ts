// GSTR-1 from a month's outward lines (M5-04, RAD-154; ADR-010 §3; RC-107). Pure, over gst_outward_lines' rows, so
// its unit tests reach every table's rule. A credit note's amounts are positive on its rows and taken off here. A note
// past section 34's limit is in no table (ADR-007 §6); a cancelled document only in Table 13.
import { dec, roundMoney, type Decimal, type Money } from '@radcore/lib-common';

export type OutwardLine = {
  documentTable: 'invoices' | 'credit_notes'; documentId: string; documentNumber: string | null; status: string; documentDate: string;
  invoiceId: string; invoiceNumber: string | null; invoiceDate: string; invoiceValue: string; buyerGstin: string | null; placeOfSupply: string;
  issuerStateCode: string; ecommerceGstin: string | null; late: boolean; hsn: string; uqc: string; qty: string; gstRate: string;
  supplyKind: string; taxable: string; cgst: string; sgst: string; igst: string; cess: string;
};
export type Tax = { taxable: Money; igst: Money; cgst: Money; sgst: Money; cess: Money };
type Rated = Tax & { rate: string };
type Doc = { number: string | null; date: string; value: Money; placeOfSupply: string; items: Rated[] };

const HEADS = ['taxable', 'igst', 'cgst', 'sgst', 'cess'] as const;
type Sum = Record<(typeof HEADS)[number] | 'qty', Decimal>;
const zero = (): Sum => ({ taxable: dec('0'), igst: dec('0'), cgst: dec('0'), sgst: dec('0'), cess: dec('0'), qty: dec('0') });
const add = (s: Sum, l: OutwardLine, sign: 1 | -1) => { for (const h of [...HEADS, 'qty'] as const) s[h] = s[h].plus(dec(l[h]).times(sign)); };
const out = (s: Sum): Tax => ({ taxable: roundMoney(s.taxable), igst: roundMoney(s.igst), cgst: roundMoney(s.cgst), sgst: roundMoney(s.sgst),
  cess: roundMoney(s.cess) });

/** Sums lines into groups by `key`, in the order each group first appears. */
function grouped<K>(lines: readonly OutwardLine[], key: (l: OutwardLine) => string, head: (l: OutwardLine) => K, sign = (l: OutwardLine): 1 | -1 =>
  (l.documentTable === 'credit_notes' ? -1 : 1)): (K & { sum: Sum })[] {
  const groups = new Map<string, K & { sum: Sum }>();
  for (const l of lines) {
    const k = key(l);
    const g = groups.get(k) ?? { ...head(l), sum: zero() };
    add(g.sum, l, sign(l));
    groups.set(k, g);
  }
  return [...groups.values()];
}

/** Each document's lines by rate, document by document (4A, 4C, 5, 9B). */
const byDocument = (lines: readonly OutwardLine[]) => grouped(lines, (l) => l.documentId, (l) => ({ l }), () => 1)
  .map(({ l }) => ({ l, items: grouped(lines.filter((x) => x.documentId === l.documentId), (x) => x.gstRate, (x) => ({ rate: x.gstRate }), () => 1)
    .map((g) => ({ rate: g.rate, ...out(g.sum) })) }));
const docOf = (l: OutwardLine, items: Rated[]): Doc => ({ number: l.documentNumber, date: l.documentDate, value: roundMoney(l.invoiceValue),
  placeOfSupply: l.placeOfSupply, items });

/** A month's GSTR-1, by ADR-010 §3's tables. `b2clLimit`: Table 5's limit (gst.b2cl_limit); `hsnDigits`: Table 12's (gst.hsn_digits). */
export function buildGstr1(rows: readonly OutwardLine[], o: { b2clLimit: string; hsnDigits: number }) {
  const b2b = (l: OutwardLine) => l.buyerGstin !== null;
  const inter = (l: OutwardLine) => l.placeOfSupply !== l.issuerStateCode;
  // B2C large is the invoice's, so a note on one follows it (CDNUR), whatever the note's own value.
  const b2cl = (l: OutwardLine) => !b2b(l) && inter(l) && dec(l.invoiceValue).gt(dec(o.b2clLimit));
  const taxed = (l: OutwardLine) => l.supplyKind === 'taxable';
  const note = (l: OutwardLine) => l.documentTable === 'credit_notes';
  const live = rows.filter((l) => l.status === 'posted' && !l.late);
  const invoices = live.filter((l) => !note(l));
  const notes = live.filter(note);

  const b2bDocs = (ecommerce: boolean) => byDocument(invoices.filter((l) => taxed(l) && b2b(l) && (l.ecommerceGstin !== null) === ecommerce));
  const noteDocs = (which: (l: OutwardLine) => boolean) => byDocument(notes.filter((l) => taxed(l) && which(l)))
    .map(({ l, items }) => ({ buyerGstin: l.buyerGstin, invoiceNumber: l.invoiceNumber, invoiceDate: l.invoiceDate, ...docOf(l, items) }));

  return {
    table4a: b2bDocs(false).map(({ l, items }) => ({ buyerGstin: l.buyerGstin ?? '', ...docOf(l, items) })),
    table4c: b2bDocs(true).map(({ l, items }) => ({ buyerGstin: l.buyerGstin ?? '', ecommerceGstin: l.ecommerceGstin ?? '', ...docOf(l, items) })),
    table5: byDocument(invoices.filter((l) => taxed(l) && b2cl(l))).map(({ l, items }) => docOf(l, items)),
    // B2C others, net of notes on B2C invoices that weren't large, in the note's own month (ADR-010 §3's 9B).
    table7: grouped(live.filter((l) => taxed(l) && !b2b(l) && !b2cl(l)), (l) => `${l.placeOfSupply} ${l.gstRate} ${l.ecommerceGstin ?? ''}`,
      (l) => ({ placeOfSupply: l.placeOfSupply, rate: l.gstRate, ecommerceGstin: l.ecommerceGstin }))
      .map(({ sum, ...g }) => ({ ...g, ...out(sum) })),
    // Nil-rated, exempt and non-GST: never Table 4, 5 or 7 (RC-107), by inter- or intra-state and registered or not.
    table8: grouped(live.filter((l) => !taxed(l)), (l) => `${inter(l) ? 'inter' : 'intra'} ${b2b(l) ? 'registered' : 'unregistered'} ${l.supplyKind}`,
      (l) => ({ supply: inter(l) ? 'inter' as const : 'intra' as const, buyer: b2b(l) ? 'registered' as const : 'unregistered' as const,
        kind: l.supplyKind })).map(({ sum, ...g }) => ({ ...g, value: roundMoney(sum.taxable) })),
    table9b: { cdnr: noteDocs(b2b), cdnur: noteDocs(b2cl) },
    // Advances: none for goods (ADR-007 §5); a service advance comes with the service module.
    table11a: [] as never[],
    table11b: [] as never[],
    // The HSN summary in its two parts, net of notes (a value note moves no quantity).
    table12: grouped(live, (l) => `${b2b(l) ? 'b2b' : 'b2c'} ${l.hsn.slice(0, o.hsnDigits)} ${l.uqc} ${l.gstRate}`,
      (l) => ({ part: b2b(l) ? 'b2b' as const : 'b2c' as const, hsn: l.hsn.slice(0, o.hsnDigits), uqc: l.uqc, rate: l.gstRate }))
      .map(({ sum, ...g }) => ({ ...g, qty: sum.qty.toFixed(), ...out(sum) })),
    table13: documentsIssued(rows),
    table14: grouped(live.filter((l) => taxed(l) && l.ecommerceGstin !== null), (l) => l.ecommerceGstin ?? '', (l) => ({ ecommerceGstin: l.ecommerceGstin ?? '' }))
      .map(({ sum, ...g }) => ({ ...g, ...out(sum) })),
  };
}

/** Table 13: per document kind and series (a number up to its last '/'), the first and last number of the month, how
 * many, and how many of them are cancelled. Numbers are zero-padded within a series, so text order is their order. */
function documentsIssued(rows: readonly OutwardLine[]) {
  const docs = new Map<string, OutwardLine>();
  for (const l of rows) if (l.documentNumber !== null) docs.set(l.documentId, l);
  const series = new Map<string, { kind: OutwardLine['documentTable']; series: string; from: string; to: string; count: number; cancelled: number }>();
  for (const d of docs.values()) {
    const docNo = d.documentNumber ?? '';
    const prefix = docNo.slice(0, docNo.lastIndexOf('/') + 1);
    const key = `${d.documentTable} ${prefix}`;
    const s = series.get(key) ?? { kind: d.documentTable, series: prefix, from: docNo, to: docNo, count: 0, cancelled: 0 };
    series.set(key, { ...s, from: docNo.localeCompare(s.from) < 0 ? docNo : s.from, to: docNo.localeCompare(s.to) > 0 ? docNo : s.to,
      count: s.count + 1, cancelled: s.cancelled + (d.status === 'cancelled' ? 1 : 0) });
  }
  return [...series.values()].toSorted((a, b) => `${a.kind} ${a.series}`.localeCompare(`${b.kind} ${b.series}`));
}
