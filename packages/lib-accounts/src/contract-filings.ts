// The filed-month lock (M5-08, RAD-156; ADR-009 §5, §9; RC-012), re-exported by ./contract: a month's return marked
// filed under gst:file, after which nothing it reports changes. Like every contract file it imports only zod and
// lib-common (D5).
import { dateString, defineContract, idString, listInput, listOf, momentString, principalOut } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const gstReturn = z.enum(['gstr1', 'gstr3b']);
/** A month as YYYY-MM. */
const monthString = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a month as YYYY-MM');

const filing = z.object({
  id: idString(), return: gstReturn, month: monthString(), arn: z.string(), filedOn: dateString(), snapshotSha256: z.string(),
  markedAt: momentString(), markedBy: principalOut, undone: z.boolean(),
});

/** GET /gst/filings (gst:returns): the filings marked, newest month first, undone ones too; by return. */
export const listGstFilings = defineContract({
  method: 'GET', path: '/gst/filings', auth: 'session', perm: 'gst:returns', tx: read,
  input: listInput(z.object({ return: gstReturn.optional() })), output: listOf(filing),
});

/** POST /gst/filings (gst:file): marks `return` filed for `month`, with the ARN the portal gave and the day it was
 * filed, and keeps what the books said (the snapshot). Only an ended month, the month after the last one filed for that
 * return or `gst.filing_start`'s. It waits for the postings in flight (ADR-009 §7). */
export const markGstFiling = defineContract({
  method: 'POST', path: '/gst/filings', auth: 'session', perm: 'gst:file', tx: write,
  input: z.object({ return: gstReturn, month: monthString(), arn: z.string().trim().min(1, 'Enter the ARN').max(40), filedOn: dateString() }),
  output: z.object({ id: idString() }),
  errors: ['month_not_ended', 'filing_gap', 'filing_start_not_set', 'already_filed', 'date_in_future', 'filed_before_month_end'],
  dbErrors: { '23505:ux_gst_filings_live': { code: 'already_filed', message: 'This return is already filed for that month' } },
});
