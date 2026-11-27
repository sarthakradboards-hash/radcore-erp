// Reads an uploaded file in its own worker thread (ADR-003 §7): a CSV or .xlsx as a table, or a PDF's text (RAD-159). The worker gets no environment, so no database or S3
// credentials; a memory cap; and a wall-clock limit that terminates it, since resourceLimits caps memory only. The
// worker runs this same file. ADR-002's L8 lifts node:worker_threads here alone, with the rest of L8 still on.
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { parsePdf, type PdfPages } from './read-pdf.ts';
import { ImportFileError, parseTable, type Table } from './read.ts';

/** The worker's caps: wall-clock time, and the V8 heap a hostile file can make it use. */
export const ISOLATE_LIMITS = { timeoutMs: 30_000, maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 } as const;
type Limits = { timeoutMs: number; maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number };

type Read = 'table' | 'pdf';
type Job = { radcoreImport: true; read: Read; bytes: Uint8Array };
type Reply = { ok: true; value: Table | PdfPages } | { ok: false; message: string | null };

const isJob = (v: unknown): v is Job => typeof v === 'object' && v !== null && 'radcoreImport' in v && 'bytes' in v && 'read' in v
  && v.radcoreImport === true && v.bytes instanceof Uint8Array && (v.read === 'table' || v.read === 'pdf');

// The worker side: only when started by readTable below, never in some other thread that imports lib-platform.
const job: unknown = workerData;
if (!isMainThread && parentPort && isJob(job)) {
  const port = parentPort;
  (job.read === 'pdf' ? parsePdf(job.bytes) : parseTable(job.bytes)).then(
    (value) => port.postMessage({ ok: true, value } satisfies Reply),
    // Only an ImportFileError's sentence crosses back; anything else is reported without its details.
    (e: unknown) => port.postMessage({ ok: false, message: e instanceof ImportFileError ? e.message : null } satisfies Reply));
}

const TOO_LONG = 'The file took too long to read. Split it and import each part.';
const TOO_BIG = 'The file needs too much memory to read. Split it and import each part.';

/** Reads an uploaded CSV or .xlsx file (read.ts's parseTable) in a worker with no credentials, a memory cap and a
 * time limit. Every refusal is an ImportFileError. */
export async function readTable(bytes: Uint8Array, limits: Limits = ISOLATE_LIMITS): Promise<Table> {
  return await inTurn('table', bytes, limits) as Table;
}

/** Reads an uploaded PDF's text as lines (read-pdf.ts's parsePdf) in the same kind of worker, within the same caps and
 * ADR-003 §7's page limit. Every refusal is an ImportFileError. Only the worker process calls it (RC-135). */
export async function readPdf(bytes: Uint8Array, limits: Limits = ISOLATE_LIMITS): Promise<PdfPages> {
  return await inTurn('pdf', bytes, limits) as PdfPages;
}

async function inTurn(read: Read, bytes: Uint8Array, limits: Limits): Promise<Table | PdfPages> {
  await turn();
  try {
    return await inWorker(read, bytes, limits);
  } finally {
    release();
  }
}

// At most MAX_WORKERS files are parsed at once in a process, each worker within its caps; the rest wait. A freed
// place is handed straight to the next in line, so a new call can't slip in between and go over.
const MAX_WORKERS = 2;
let running = 0;
const waiting: (() => void)[] = [];
const turn = async (): Promise<void> => {
  if (running < MAX_WORKERS) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
};
const release = (): void => {
  const next = waiting.shift();
  if (next) next();
  else running--;
};

function inWorker(read: Read, bytes: Uint8Array, limits: Limits): Promise<Table | PdfPages> {
  return new Promise<Table | PdfPages>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { radcoreImport: true, read, bytes } satisfies Job,
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb },
    });
    let done = false;
    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Answered once the worker has stopped, so its place (and its memory) is free before the next one starts.
      void worker.terminate().finally(fn);
    };
    const timer = setTimeout(() => settle(() => reject(new ImportFileError(TOO_LONG))), limits.timeoutMs);
    worker.once('message', (r: Reply) => settle(() => {
      if (r.ok) resolve(r.value);
      else reject(r.message === null ? new Error('The import worker failed to read the file') : new ImportFileError(r.message));
    }));
    worker.once('error', (e: Error & { code?: string }) => settle(() =>
      reject(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ImportFileError(TOO_BIG) : e)));
    worker.once('exit', (code) => settle(() => reject(new Error(`The import worker stopped (exit code ${String(code)})`))));
  });
}
