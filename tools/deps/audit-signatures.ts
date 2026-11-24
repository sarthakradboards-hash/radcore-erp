// C10 (ADR-003): `npm audit signatures` after `npm ci`, which fails on an invalid or missing registry signature. The
// registry's keys endpoint sometimes answers a bare "OK" that isn't JSON, and npm reports FETCH_ERROR: that one answer,
// and only that one, is tried again, three tries in all, 30 s then 60 s apart (the architect on RAD-62). It passes only
// when npm's report parses and names no invalid or missing signature; anything else fails, as before. Uses only Node's
// own modules, as the rest of tools/deps does.
//   node tools/deps/audit-signatures.ts
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Answer = { status: number | null; stdout: string; stderr: string };
type Verdict = { verdict: 'pass' | 'retry' | 'fail'; message: string };

/** The waits before each try after the first. */
export const WAITS_MS = [30_000, 60_000] as const;

/** One answer of `npm audit signatures --json`, judged. */
export function judge(a: Answer): Verdict {
  let report: unknown;
  try {
    report = JSON.parse(a.stdout);
  } catch {
    report = undefined;
  }
  const r = report as { invalid?: unknown; missing?: unknown; error?: { code?: unknown } } | undefined;
  if (r !== undefined && Array.isArray(r.invalid) && Array.isArray(r.missing)) {
    if (r.invalid.length === 0 && r.missing.length === 0 && a.status === 0) return { verdict: 'pass', message: 'C10: every registry signature verified' };
    return { verdict: 'fail', message: `C10: ${r.invalid.length} invalid and ${r.missing.length} missing registry signature(s): ${a.stdout.trim()}` };
  }
  // npm's FETCH_ERROR, as its --json error object or its log line; the report never parsed, so nothing was verified.
  if (r?.error?.code === 'FETCH_ERROR' || /\bFETCH_ERROR\b/.test(`${a.stdout}\n${a.stderr}`)) {
    return { verdict: 'retry', message: `C10: the registry's answer couldn't be read (FETCH_ERROR): ${a.stderr.trim() || a.stdout.trim()}` };
  }
  return { verdict: 'fail', message: `C10: npm audit signatures exited ${String(a.status)} with no report: ${a.stderr.trim() || a.stdout.trim()}` };
}

/** Runs the audit, trying again after each wait while the answer is FETCH_ERROR; the last verdict stands. */
export async function auditSignatures(run: () => Answer, wait: (ms: number) => Promise<void>, log: (line: string) => void = console.log): Promise<Verdict> {
  let v = judge(run());
  for (const ms of WAITS_MS) {
    if (v.verdict !== 'retry') return v;
    log(`${v.message}; trying again in ${ms / 1000} s`);
    await wait(ms);
    v = judge(run());
  }
  return v.verdict === 'retry' ? { verdict: 'fail', message: `${v.message}, ${WAITS_MS.length + 1} times` } : v;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // One fixed command string through the shell, because npm is npm.cmd on Windows (as cli.ts runs npm audit).
  const run = (): Answer => {
    const r = spawnSync('npm audit signatures --json', { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const v = await auditSignatures(run, (ms) => new Promise((done) => setTimeout(done, ms)));
  console.log(v.message);
  if (v.verdict !== 'pass') process.exitCode = 1;
}
