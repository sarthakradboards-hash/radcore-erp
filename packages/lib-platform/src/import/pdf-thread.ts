// A PDF reader's worker thread (RAD-159; ADR-003 §7; RC-135): its own entry, so unpdf (pdf.js) loads in this thread
// alone, never in the process that starts it (auditor-2 on #438). isolate.ts's readPdf starts it with no environment,
// the same caps as a table's reader, and the job as its workerData; it answers as that reader's thread does.
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parsePdf } from './read-pdf.ts';
import { ImportFileError } from './read.ts';

const isPdfJob = (v: unknown): v is { radcorePdf: true; bytes: Uint8Array } => typeof v === 'object' && v !== null
  && 'radcorePdf' in v && v.radcorePdf === true && 'bytes' in v && v.bytes instanceof Uint8Array;

const job: unknown = workerData;
if (!isMainThread && parentPort !== null && isPdfJob(job)) {
  const port = parentPort;
  parsePdf(job.bytes).then(
    (value) => port.postMessage({ ok: true, value }),
    // Only an ImportFileError's sentence crosses back; anything else is reported without its details.
    (e: unknown) => port.postMessage({ ok: false, message: e instanceof ImportFileError ? e.message : null }));
}
