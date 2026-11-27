// Reads an uploaded file in its own worker thread (ADR-003 §7): a CSV or .xlsx as a table, or a PDF's text (RAD-159).
// The worker gets no environment, so no database or S3 credentials; a heap cap; a watch on the process's memory, since
// the heap cap leaves out ArrayBuffers, where pdf.js keeps a decoded stream (auditor-2 on #438); and a wall-clock limit
// that terminates it. The worker runs this same file. ADR-002's L8 lifts node:worker_threads here alone.
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import type { PdfPages } from './read-pdf.ts';
import { ImportFileError, parseTable, type Table } from './read.ts';

/** The worker's caps: wall-clock time, and the V8 heap a hostile file can make it use. */
export const ISOLATE_LIMITS = { timeoutMs: 30_000, maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, maxGrowthMb: 640 } as const;
/** `maxGrowthMb`: how far the process's resident memory may grow while the worker reads, ArrayBuffers included. */
type Limits = { timeoutMs: number; maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number; maxGrowthMb: number };

type Read = 'table' | 'pdf';
type Job = { radcoreImport: true; bytes: Uint8Array };
type Reply = { ok: true; value: Table | PdfPages } | { ok: false; message: string | null };

const isJob = (v: unknown): v is Job => typeof v === 'object' && v !== null && 'radcoreImport' in v && 'bytes' in v
  && v.radcoreImport === true && v.bytes instanceof Uint8Array;

// The worker side: only when started by readTable below, never in some other thread that imports lib-platform.
const job: unknown = workerData;
if (!isMainThread && parentPort && isJob(job)) {
  const port = parentPort;
  parseTable(job.bytes).then(
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
    // A PDF has its own thread's entry, so unpdf loads only there (pdf-thread.ts); a table's reader is this file.
    const worker = new Worker(read === 'pdf' ? new URL('./pdf-thread.ts', import.meta.url) : new URL(import.meta.url), {
      workerData: read === 'pdf' ? { radcorePdf: true, bytes } : { radcoreImport: true, bytes } satisfies Job,
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb },
    });
    let done = false;
    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      // Answered once the worker has stopped, so its place (and its memory) is free before the next one starts.
      void worker.terminate().finally(fn);
    };
    const timer = setTimeout(() => settle(() => reject(new ImportFileError(TOO_LONG))), limits.timeoutMs);
    // From this thread, which stays free while the worker decodes: the process's resident memory, so an ArrayBuffer a
    // decompression bomb fills counts too. Another file read at once grows it as well, which only refuses sooner.
    const start = process.memoryUsage.rss();
    const watch = setInterval(() => {
      if (process.memoryUsage.rss() - start > limits.maxGrowthMb * 1024 * 1024) settle(() => reject(new ImportFileError(TOO_BIG)));
    }, 20);
    worker.once('message', (r: Reply) => settle(() => {
      if (r.ok) resolve(r.value);
      else reject(r.message === null ? new Error('The import worker failed to read the file') : new ImportFileError(r.message));
    }));
    worker.once('error', (e: Error & { code?: string }) => settle(() =>
      reject(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ImportFileError(TOO_BIG) : e)));
    worker.once('exit', (code) => settle(() => reject(new Error(`The import worker stopped (exit code ${String(code)})`))));
  });
}
