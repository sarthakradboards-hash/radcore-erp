// The print pool (RAD-120, the architect's ruling): PDFs render in the api's own request, but off its event loop, in
// a small set of node:worker_threads threads kept warm with the PDF library and the fonts loaded. Each render has
// PRINT_LIMITS.renderMs: past it the thread is terminated and replaced, and the caller gets server_error. Each thread's
// heap is capped (resourceLimits), and it starts with no environment, so no credential is in reach (as the parsers').
// Each thread runs render-thread.ts, marked with MARK so only the pool's own threads ever take its branch.
import { Worker } from 'node:worker_threads';
import type { Paper } from '../contract/print.ts';
import { AppError } from '../errors.ts';
import { PRINT_LIMITS, type PrintBlock } from './blocks.ts';
import { MARK, type Done, type Job } from './render-thread.ts';

export type PrintPool = {
  render(blocks: readonly PrintBlock[], paper: Paper, title: string): Promise<Uint8Array>;
  close(): Promise<void>;
};

type Waiting = { job: Job; resolve: (pdf: Uint8Array) => void; reject: (e: unknown) => void };
type Thread = { worker: Worker; ready: boolean; doing: (Waiting & { timer: NodeJS.Timeout }) | null };

/** A pool of `size` threads running `entry` (render-thread.ts). `renderMs` and `heapMb` are PRINT_LIMITS'. */
export function createPrintPool({ size = 2, renderMs = PRINT_LIMITS.renderMs, heapMb = PRINT_LIMITS.heapMb,
  entry = new URL('./render-thread.ts', import.meta.url) }: { size?: number; renderMs?: number; heapMb?: number; entry?: URL } = {}): PrintPool {
  const queue: Waiting[] = [];
  const threads: Thread[] = [];
  let next = 0;
  let closed = false;
  const failed = (message: string) => new AppError('server_error', `The printout couldn't be made: ${message}`);

  const start = (): Thread => {
    const worker = new Worker(entry, { env: {}, workerData: MARK, resourceLimits: { maxOldGenerationSizeMb: heapMb } });
    // A warm thread never keeps the process from exiting.
    worker.unref();
    const t: Thread = { worker, ready: false, doing: null };
    worker.on('message', (m: Done | 'ready') => {
      if (m === 'ready') {
        t.ready = true;
      } else if (t.doing !== null && t.doing.job.id === m.id) {
        const { resolve, reject, timer } = t.doing;
        clearTimeout(timer);
        t.doing = null;
        if ('pdf' in m) resolve(m.pdf);
        else reject(m.failed === 'too_large' ? new AppError('too_large', `This document is over ${PRINT_LIMITS.pages} pages`) : failed(m.message));
      }
      pump();
    });
    // A thread that dies on its own (out of memory, a crash) fails its job and is replaced.
    worker.on('exit', () => {
      if (t.doing !== null) {
        clearTimeout(t.doing.timer);
        t.doing.reject(failed('the print thread stopped'));
        t.doing = null;
      }
      retire(t);
    });
    return t;
  };
  /** Takes a thread out of the pool at once, so no job goes to it, and starts its replacement. */
  const retire = (t: Thread) => {
    const i = threads.indexOf(t);
    if (i < 0) return;
    threads.splice(i, 1);
    if (!closed) threads.push(start());
    pump();
  };

  const pump = () => {
    for (const t of threads) {
      const w = t.ready && t.doing === null ? queue.shift() : undefined;
      if (w === undefined) continue;
      // Past its time the job fails and the thread is retired and terminated.
      const timer = setTimeout(() => {
        if (t.doing === null) return;
        const { reject } = t.doing;
        t.doing = null;
        reject(failed(`it took more than ${renderMs} ms`));
        retire(t);
        void t.worker.terminate();
      }, renderMs);
      t.doing = { ...w, timer };
      t.worker.postMessage(w.job);
    }
  };

  for (let i = 0; i < size; i++) threads.push(start());
  return {
    render: (blocks, paper, title) => new Promise<Uint8Array>((resolve, reject) => {
      if (closed) return reject(failed('the print pool is closed'));
      queue.push({ job: { id: next++, blocks, paper, title }, resolve, reject });
      pump();
    }),
    close: async () => {
      closed = true;
      await Promise.all(threads.map((t) => t.worker.terminate()));
    },
  };
}

let shared: PrintPool | undefined;
/** Renders on the process's pool, started on the first print and kept warm after. */
export const renderPdf = (blocks: readonly PrintBlock[], paper: Paper, title: string): Promise<Uint8Array> =>
  (shared ??= createPrintPool()).render(blocks, paper, title);
