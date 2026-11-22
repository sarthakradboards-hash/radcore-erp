// What the sales printouts share (RAD-120): the issuer's block, an address on one line, the signature, and figures
// as a person reads them.
import { getPartyById } from '@radcore/lib-accounts';
import { dec, formatMoney } from '@radcore/lib-common';
import type { Ctx, PrintBlock } from '@radcore/lib-platform';
import { plain } from '../services/invoice-post.ts';

type Address = { addressLine1: string | null; addressLine2: string | null; city: string | null; pincode: string | null };

/** An address on one line, its empty parts left out. */
const oneLine = (a: Address): string =>
  [a.addressLine1, a.addressLine2, [a.city, a.pincode].filter((x) => x !== null && x !== '').join(' ')].filter((x) => x !== null && x !== '').join(', ');

/** A quantity without trailing zeros (1.000 is 1), with its unit. */
export const quantity = (q: string, unit = ''): string => `${dec(q).toString()}${unit === '' ? '' : ` ${unit}`}`;
/** A money figure in rupees, or a dash when it isn't worked out. */
export const rupees = (x: string | null): string => (x === null ? '—' : formatMoney(x));
/** A rate as a percentage: 5.00 is 5%. */
export const percent = (x: string | null): string => (x === null ? '—' : `${dec(x).toString()}%`);

/** Who issues the document: the company's legal name, address and GSTIN. */
export const issuerBlocks = (c: Address & { legalName: string; gstin: string; stateCode: string } | null): PrintBlock[] =>
  c === null ? [] : [
    { kind: 'text', text: c.legalName, bold: true },
    { kind: 'text', text: oneLine(c) },
    { kind: 'pairs', rows: [['GSTIN', c.gstin], ['State code', c.stateCode]] },
  ];

/** A party's name, GSTIN, state and address as stored, for a printout that names who it's for. */
export async function partyOf(ctx: Ctx, id: string) {
  const p = await getPartyById(ctx, { id });
  return { name: p.name, gstin: p.gstin, stateCode: p.stateCode, addressLine1: plain(p.addressLine1), addressLine2: plain(p.addressLine2),
    city: plain(p.city), pincode: plain(p.pincode) };
}

/** Who a document is for: its name, address, GSTIN (or that it has none) and state. */
export const partyBlocks = (heading: string, p: Address & { name: string; gstin: string | null; stateCode: string }): PrintBlock[] => {
  const address = oneLine(p);
  return [
    { kind: 'text', text: heading, bold: true },
    { kind: 'text', text: p.name },
    ...(address === '' ? [] : [{ kind: 'text', text: address } as const]),
    { kind: 'pairs', rows: [['GSTIN', p.gstin ?? 'Unregistered'], ['State code', p.stateCode]] },
  ];
};

/** The issuer's signature line. */
export const signature = (legalName: string): PrintBlock[] => [
  { kind: 'rule' },
  { kind: 'text', text: `For ${legalName}`, align: 'right', bold: true },
  { kind: 'text', text: 'Authorised signatory', align: 'right', small: true },
];

/** The tax totals that aren't nothing, then the total. */
export const taxTotals = (t: { taxable: string; cgst: string | null; sgst: string | null; igst: string | null; cess?: string;
  roundOff: string | null; total: string | null }) => {
  const rows: { label: string; value: string; strong?: boolean }[] = [{ label: 'Taxable value', value: rupees(t.taxable) }];
  for (const [label, v] of [['CGST', t.cgst], ['SGST', t.sgst], ['IGST', t.igst], ['Cess', t.cess ?? null], ['Round off', t.roundOff]] as const) {
    if (v !== null && !dec(v).isZero()) rows.push({ label, value: rupees(v) });
  }
  rows.push({ label: 'Total', value: rupees(t.total), strong: true });
  return rows;
};
