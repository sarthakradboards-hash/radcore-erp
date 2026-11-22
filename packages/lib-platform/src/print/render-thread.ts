// A print pool thread (RAD-120): renders each job it's sent and answers the PDF's bytes, or why not. It loads the PDF
// library and the fonts once, when it starts, so a print pays none of that. Started by pool.ts with no environment
// and MARK as its workerData, so a test runner's own thread that loads this file never takes the branch below.
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { Paper } from '../contract/print.ts';
import type { PrintBlock } from './blocks.ts';
import { renderBlocks, TooLarge } from './render.ts';

export const MARK = { radcorePrint: true } as const;
export type Job = { id: number; blocks: readonly PrintBlock[]; paper: Paper; title: string };
export type Done = { id: number; pdf: Uint8Array } | { id: number; failed: 'too_large' | 'error'; message: string };

const isPrintThread = (d: unknown) => typeof d === 'object' && d !== null && (d as { radcorePrint?: unknown }).radcorePrint === true;
if (!isMainThread && parentPort !== null && isPrintThread(workerData)) {
  const port = parentPort;
  port.on('message', (job: Job) => {
    renderBlocks(job.blocks, job.paper, job.title).then((pdf) => {
      port.postMessage({ id: job.id, pdf: new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength) } satisfies Done);
    }, (e: unknown) => {
      port.postMessage({ id: job.id, failed: e instanceof TooLarge ? 'too_large' : 'error',
        message: e instanceof Error ? e.message : String(e) } satisfies Done);
    });
  });
  port.postMessage('ready');
}
