// C10's wrapper (RAD-62, the architect's ruling): `npm audit signatures --json` tried again only on the registry's
// unreadable answer (FETCH_ERROR), three tries 30 s then 60 s apart; it passes only on a clean report. Fixtures stand in
// for npm's answers, and the waits are recorded, not slept.
import { describe, expect, it } from 'vitest';
import { auditSignatures, judge, WAITS_MS, type Answer } from './deps/audit-signatures.ts';

const CLEAN: Answer = { status: 0, stdout: '{\n  "invalid": [],\n  "missing": []\n}\n', stderr: '' };
const BAD: Answer = { status: 1, stdout: JSON.stringify({ invalid: [{ name: 'left-pad', version: '1.3.0', code: 'EINTEGRITYSIGNATURE' }], missing: [] }),
  stderr: '' };
const MISSING: Answer = { status: 1, stdout: JSON.stringify({ invalid: [], missing: [{ name: 'is-odd', version: '3.0.1' }] }), stderr: '' };
// What CI met: the keys endpoint answered "OK", which npm couldn't read as JSON.
const FETCH: Answer = { status: 1, stdout: JSON.stringify({ error: { code: 'FETCH_ERROR', summary:
  'invalid json response body at https://registry.npmjs.org/-/npm/v1/keys reason: Unexpected token \'O\', "OK" is not valid JSON', detail: '' } }),
  stderr: 'npm error code FETCH_ERROR\n' };
const OTHER: Answer = { status: 1, stdout: '', stderr: 'npm error code E403\nnpm error 403 Forbidden\n' };

/** Runs the wrapper over `answers`, one per try, recording the waits. */
async function over(answers: Answer[]) {
  const waits: number[] = [];
  let tries = 0;
  const v = await auditSignatures(() => answers[Math.min(tries++, answers.length - 1)] ?? OTHER, async (ms) => {
    waits.push(ms);
  }, () => undefined);
  return { verdict: v.verdict, message: v.message, tries, waits };
}

describe('C10, npm audit signatures with its retry', () => {
  it('passes a clean report at once', async () => {
    expect(await over([CLEAN])).toMatchObject({ verdict: 'pass', tries: 1, waits: [] });
  });

  it('tries again after FETCH_ERROR, 30 s then 60 s apart, and passes the clean report that follows', async () => {
    expect(await over([FETCH, CLEAN])).toMatchObject({ verdict: 'pass', tries: 2, waits: [30_000] });
    expect(await over([FETCH, FETCH, CLEAN])).toMatchObject({ verdict: 'pass', tries: 3, waits: [30_000, 60_000] });
  });

  it('fails after three FETCH_ERRORs, with no fourth try', async () => {
    const r = await over([FETCH, FETCH, FETCH, CLEAN]);
    expect([r.verdict, r.tries, r.waits]).toEqual(['fail', 3, [...WAITS_MS]]);
    expect(r.message).toContain('FETCH_ERROR');
  });

  it('fails an invalid or a missing signature at once, never trying again', async () => {
    for (const bad of [BAD, MISSING]) {
      const r = await over([bad, CLEAN]);
      expect([r.verdict, r.tries, r.waits]).toEqual(['fail', 1, []]);
    }
    expect((await over([BAD])).message).toContain('1 invalid and 0 missing');
    // A bad signature after a FETCH_ERROR still fails.
    expect(await over([FETCH, BAD, CLEAN])).toMatchObject({ verdict: 'fail', tries: 2 });
  });

  it('fails any other answer at once: another error, no report, or a clean-looking report with a failing exit', () => {
    expect([judge(OTHER).verdict, judge({ status: 1, stdout: 'OK', stderr: '' }).verdict, judge({ ...CLEAN, status: 1 }).verdict])
      .toEqual(['fail', 'fail', 'fail']);
  });

  it('knows FETCH_ERROR by npm’s log line alone too', () => {
    expect(judge({ status: 1, stdout: '', stderr: 'npm error code FETCH_ERROR\nnpm error errno FETCH_ERROR\n' }).verdict).toBe('retry');
  });
});
