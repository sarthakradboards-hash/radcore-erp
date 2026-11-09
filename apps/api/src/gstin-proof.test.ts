// RC-186, API side: a bad GSTIN is refused by the same lib-common rule the web form uses (apps/web/lib/api-client.test.ts).
// readInput is what the generic handler (M1-08) runs on every request, before any service.
import { defineContract, gstinString, PLATFORM_ERRORS, readInput, requestFor } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const createParty = defineContract({
  method: 'POST', path: '/accounts/parties', auth: 'session', perm: 'parties:write',
  tx: { readOnly: false, isolation: 'read committed' },
  input: z.object({ name: z.string().min(1), gstin: gstinString() }), output: z.object({ id: z.string() }),
});

describe('RC-186: the API refuses a bad GSTIN', () => {
  it('answers 400 invalid_input with the issue on the gstin field', () => {
    const body = JSON.parse(requestFor(createParty, { name: 'Asha Motors', gstin: '27AAPFU0939F1Z' }).body ?? '');
    expect(readInput(createParty, { params: {}, body })).toMatchObject({ ok: false, error: { code: 'invalid_input',
      issues: [{ path: ['gstin'], code: 'custom', message: 'Enter a valid 15-character GSTIN, in capitals' }] } });
    expect(PLATFORM_ERRORS.invalid_input).toBe(400);
  });

  it('lets a valid GSTIN through', () => {
    expect(readInput(createParty, { params: {}, body: { name: 'Asha Motors', gstin: '27AAPFU0939F1ZV' } }).ok).toBe(true);
  });
});
