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

/** A print waiting for a thread: its time counts from when it was asked for, not from when a thread takes it. */
type Waiting = { job: Job; resolve: (pdf: Uint8Array) => void; reject: (e: unknown) => void; deadline: number; timer: NodeJS.Timeout };
type Thread = { worker: Worker; ready: boolean; doing: Waiting | null; error: string | null };

/** Prints waiting past this are refused at once, rate_limited (the auditor on #317), so the queue never grows unbounded. */
const QUEUE_MAX = 20;

/** A pool of `size` threads running `entry` (render-thread.ts). `renderMs` and `heapMb` are PRINT_LIMITS'. */
export function createPrintPool({ size = 2, renderMs = PRINT_LIMITS.renderMs, heapMb = PRINT_LIMITS.heapMb,
  entry = new URL('./render-thread.ts', import.meta.url) }: { size?: number; renderMs?: number; heapMb?: number; entry?: URL } = {}): PrintPool {
  const queue: Waiting[] = [];
  const threads: Thread[] = [];
  let next = 0;
  let closed = false;
  const failed = (message: string) => new AppError('server_error', `The printout couldn't be made: ${message}`);
  const late = () => failed(`it took more than ${renderMs} ms`);

  const start = (): Thread => {
    const worker = new Worker(entry, { env: {}, workerData: MARK, resourceLimits: { maxOldGenerationSizeMb: heapMb } });
    // A warm thread never keeps the process from exiting.
    worker.unref();
    const t: Thread = { worker, ready: false, doing: null, error: null };
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
    // Past its heap (ERR_WORKER_OUT_OF_MEMORY) or a throw as it loads: kept for the job's failure, which the handler
    // logs, so it never reaches the process as an unhandled 'error' (the auditor on #317). Its exit follows.
    worker.on('error', (e: Error) => {
      t.error = e.message;
    });
    worker.on('exit', () => {
      const stopped = failed(`the print thread stopped${t.error === null ? '' : `: ${t.error}`}`);
      if (t.doing !== null) {
        clearTimeout(t.doing.timer);
        t.doing.reject(stopped);
        t.doing = null;
      }
      // One that never got ready (its library or fonts didn't load) isn't restarted in a loop: what's waiting fails,
      // and the next print starts a thread again.
      if (!t.ready) {
        drop(t);
        if (!threads.some((x) => x.ready)) for (const w of queue.splice(0)) fail(w, stopped);
        return;
      }
      retire(t);
    });
    return t;
  };
  const drop = (t: Thread) => {
    const i = threads.indexOf(t);
    if (i >= 0) threads.splice(i, 1);
  };
  /** Takes a thread out of the pool at once, so no job goes to it, and starts its replacement. */
  const retire = (t: Thread) => {
    if (!threads.includes(t)) return;
    drop(t);
    if (!closed) threads.push(start());
    pump();
  };
  const fail = (w: Waiting, e: unknown) => {
    clearTimeout(w.timer);
    w.reject(e);
  };
  /** Starts threads up to `size`: at first, and again after one that never got ready. */
  const top = () => {
    while (!closed && threads.length < size) threads.push(start());
  };

  const pump = () => {
    for (const t of threads) {
      const w = t.ready && t.doing === null ? queue.shift() : undefined;
      if (w === undefined) continue;
      // Whatever's left of its time: past it the job fails and the thread is retired and terminated.
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        if (t.doing !== w) return;
        t.doing = null;
        w.reject(late());
        retire(t);
        void t.worker.terminate();
      }, Math.max(0, w.deadline - Date.now()));
      t.doing = w;
      t.worker.postMessage(w.job);
    }
  };

  top();
  return {
    render: (blocks, paper, title) => new Promise<Uint8Array>((resolve, reject) => {
      if (closed) return reject(failed('the print pool is closed'));
      if (queue.length >= QUEUE_MAX) return reject(new AppError('rate_limited', 'The printer is busy: try again in a moment', [], 5));
      // Its time starts now: a print that waits its whole time for a thread fails, as one that renders too long does.
      const w: Waiting = { job: { id: next++, blocks, paper, title }, resolve, reject, deadline: Date.now() + renderMs,
        timer: setTimeout(() => {
          const i = queue.indexOf(w);
          if (i >= 0) fail(queue.splice(i, 1)[0] ?? w, late());
        }, renderMs) };
      queue.push(w);
      top();
      pump();
    }),
    close: async () => {
      closed = true;
      for (const w of queue.splice(0)) fail(w, failed('the print pool is closed'));
      await Promise.all(threads.map((t) => t.worker.terminate()));
    },
  };
}

let shared: PrintPool | undefined;
/** Renders on the process's pool, started on the first print and kept warm after. */
export const renderPdf = (blocks: readonly PrintBlock[], paper: Paper, title: string): Promise<Uint8Array> =>
  (shared ??= createPrintPool()).render(blocks, paper, title);
