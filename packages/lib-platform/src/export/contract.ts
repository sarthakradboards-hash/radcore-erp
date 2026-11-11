// The export contracts (RAD-47 part 2), re-exported by lib-platform's contract entry. Like every contract file it
// imports only zod and lib-common (D5), so the browser can load it.
import { defineContract, idString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** An export's row cap (RAD-47, ADR-002 Exports): just under a spreadsheet's 1,048,576 rows, so any export opens
 * whole. Past it the export fails `too_large` and keeps no file; it's never cut short (RC-086). */
export const EXPORT_MAX_ROWS = 1_000_000;
const exportStatus = z.enum(['queued', 'ready', 'failed']);

/** An export's progress, for the person who started it; anyone else's id answers not_found. `failure` says why a
 * failed one failed: `too_large` means more than EXPORT_MAX_ROWS rows, so the screen asks to narrow the filter. */
export const getExport = defineContract({
  method: 'GET', path: '/exports/:id', auth: 'session', perm: 'session:read', tx: read,
  input: z.object({ id: idString() }),
  output: z.object({ status: exportStatus, rows: z.number().int().nonnegative().nullable(),
    failure: z.enum(['too_large', 'failed']).nullable() }),
});

/** A short-lived link that downloads a ready export as an attachment, for the person who started it; recorded as a
 * `download` security event (RC-031). Not yet ready, or failed: not_ready. */
export const downloadExport = defineContract({
  method: 'POST', path: '/exports/:id/download', auth: 'session', perm: 'session:read', tx: write,
  input: z.object({ id: idString() }), output: z.object({ url: z.string() }), errors: ['not_ready'],
});
