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

/**
 * Who a printout is for: the party's name, GSTIN, state and address, never its phone or email (the architect on
 * RAD-120). A statutory document (a challan, under Rule 55) prints the address in full; any other prints it as the
 * screen does, only with parties:contact or pii:read, and "Hidden" without. `shown` says the address is on the page,
 * so the printout logs a look at the party.
 */
export async function partyOf(ctx: Ctx, id: string, statutory: boolean) {
  const p = await getPartyById(ctx, { id });
  const shown = statutory || ctx.shows('whole', 'parties:contact');
  return { id: p.id, name: p.name, gstin: p.gstin, stateCode: p.stateCode, shown,
    addressLine1: shown ? plain(p.addressLine1) : 'Hidden', addressLine2: shown ? plain(p.addressLine2) : null,
    city: shown ? plain(p.city) : null, pincode: shown ? plain(p.pincode) : null };
}
/** A look at the party, when its address is on the page. */
export const partyLook = (party: { id: string; shown: boolean }) => (party.shown ? [{ table: 'parties', id: party.id }] : []);

/** Who a document is for: its name, address, GSTIN (or that it has none) and state. */
export const partyBlocks = (heading: string, p: Partial<Address> & { name: string; gstin: string | null; stateCode: string }): PrintBlock[] => {
  const address = oneLine({ addressLine1: p.addressLine1 ?? null, addressLine2: p.addressLine2 ?? null, city: p.city ?? null, pincode: p.pincode ?? null });
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
