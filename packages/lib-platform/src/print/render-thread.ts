// A print pool thread (RAD-120): renders each job it's sent and answers the PDF's bytes, or why not. It loads the PDF
// library and the fonts once, when it starts, so a print pays none of that. Started by pool.ts with no environment.
import { parentPort } from 'node:worker_threads';
import type { Paper } from '../contract/print.ts';
import type { PrintBlock } from './blocks.ts';
import { renderBlocks, TooLarge } from './render.ts';

export type Job = { id: number; blocks: readonly PrintBlock[]; paper: Paper; title: string };
export type Done = { id: number; pdf: Uint8Array } | { id: number; failed: 'too_large' | 'error'; message: string };

parentPort?.on('message', (job: Job) => {
  renderBlocks(job.blocks, job.paper, job.title).then((pdf) => {
    const bytes = new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
    parentPort?.postMessage({ id: job.id, pdf: bytes } satisfies Done);
  }, (e: unknown) => {
    parentPort?.postMessage({ id: job.id, failed: e instanceof TooLarge ? 'too_large' : 'error',
      message: e instanceof Error ? e.message : String(e) } satisfies Done);
  });
});
parentPort?.postMessage('ready');
