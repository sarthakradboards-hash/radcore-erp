// GSTR-1 (M5-04, RAD-154; ADR-010 §1, §3, §14): built from the month's lines in gst_outward_lines, never stored until it's
// filed, and its settings, strict until the CA confirms them (D-08), so the settings screen edits them as they are.
import { gstTx } from '@radcore/db/gst';
import { vGstDocumentsIssued, vGstOutwardLines } from '@radcore/db/views';
import { moneyString, roundMoney } from '@radcore/lib-common';
import { defineSetting, type Ctx } from '@radcore/lib-platform';
import { and, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { getGstr1 } from '../contract.ts';
import { buildGstr1, type IssuedDocument, type OutwardLine } from '../rules/gstr1.ts';

/** B2C large (Table 5): an inter-state invoice to a buyer with no GSTIN above this, invoice by invoice. 1,00,000 is the
 * limit from 1 August 2024; the CA confirms it before the first return. */
export const B2CL_LIMIT = defineSetting('gst.b2cl_limit', moneyString(), roundMoney('100000'), {
  label: 'B2C large invoice limit',
  description: 'GSTR-1 lists an inter-state invoice to a buyer with no GSTIN one by one (Table 5) when its value is above this. The CA confirms it.',
  input: { kind: 'money' },
});

/** Table 12's HSN summary, by the first this many digits of each HSN (CA-17). */
export const HSN_DIGITS = defineSetting('gst.hsn_digits', z.enum(['4', '6', '8']), '6', {
  label: 'HSN digits in GSTR-1',
  description: 'How many digits of each HSN GSTR-1’s HSN summary (Table 12) groups by. The CA confirms it (CA-17).',
  input: { kind: 'choice', choices: [{ value: '4', label: '4 digits' }, { value: '6', label: '6 digits' }, { value: '8', label: '8 digits' }] },
});

/** The last day an invoice's GSTIN may be amended (ADR-010 §5, CA-11): this month and day after its financial year ends,
 * 30 November by section 37(3) until the CA says otherwise. */
export const AMENDMENT_LAST_DAY = defineSetting('gst.amendment_last_day', z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/), '11-30', {
  label: 'Last day to amend an invoice',
  description: 'An invoice’s buyer GSTIN can be corrected (GSTR-1 Table 9A) until this month and day after its financial year ends (MM-DD). The CA confirms it.',
  input: { kind: 'text' },
});

/** The first day of the month after `month` (YYYY-MM). */
const monthAfter = (month: string): string => {
  const [y, m] = month.split('-').map((x) => Number.parseInt(x, 10));
  return m === 12 ? `${(y ?? 0) + 1}-01-01` : `${y ?? 0}-${String((m ?? 0) + 1).padStart(2, '0')}-01`;
};

/** GET /gst/returns/gstr1: the month's lines, by each document's own business date, into ADR-010 §3's tables. */
export async function gstr1Of(ctx: Ctx, { month }: z.output<(typeof getGstr1)['input']>): Promise<z.input<(typeof getGstr1)['output']>> {
  const rows = await gstTx(ctx).select().from(vGstOutwardLines)
    .where(and(gte(vGstOutwardLines.documentDate, `${month}-01`), lt(vGstOutwardLines.documentDate, monthAfter(month))));
  const issued = await gstTx(ctx).select({ documentType: vGstDocumentsIssued.documentType, documentNumber: vGstDocumentsIssued.documentNumber,
    status: vGstDocumentsIssued.status }).from(vGstDocumentsIssued)
    .where(and(gte(vGstDocumentsIssued.documentDate, `${month}-01`), lt(vGstDocumentsIssued.documentDate, monthAfter(month))));
  const built = buildGstr1(rows as OutwardLine[], { b2clLimit: ctx.settings.get(B2CL_LIMIT), hsnDigits: Number.parseInt(ctx.settings.get(HSN_DIGITS), 10),
    issued: issued as IssuedDocument[] });
  return { month, ...built };
}
