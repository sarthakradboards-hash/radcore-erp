// RAD-120's load-failure test (the auditor on #317): a print thread that throws as it loads while the marker file
// named for this process exists, as one whose fonts are missing would, and loads as the real thread does otherwise.
// The marker sits beside this file: the pool starts its threads with no environment, so os.tmpdir() differs there.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const crashMarker = (): string => fileURLToPath(new URL(`./.print-crash-${process.pid}`, import.meta.url));
if (existsSync(crashMarker())) throw new Error('the fonts did not load');
await import('../packages/lib-platform/src/print/render-thread.ts');
