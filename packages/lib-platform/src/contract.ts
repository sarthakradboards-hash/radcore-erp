// lib-platform's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import { defineContract, idString, momentString } from '@radcore/lib-common';
import { z } from 'zod';

/** Permission keys, sorted and without duplicates, so the client can compare two answers as they are. */
const permissionKeys = z.array(z.string()).refine((keys) => keys.every((k, i) => i === 0 || (keys[i - 1] ?? '') < k),
  { error: 'Permission keys are sorted and appear once each' });

/**
 * GET /me (RAD-34, for RAD-50's shell, RAD-52's per-minute refresh and RAD-55's signed-out dialog): who is signed
 * in, what they may do now, and when their session ends. No session answers 401 `signed_out`; it never redirects.
 * No roles, email or phone: permissions are enough, and every screen fetches this.
 */
export const getMe = defineContract({
  method: 'GET', path: '/me', auth: 'session',
  perm: 'session:read', // held by every role: any signed-in person may read their own session
  tx: { readOnly: true, isolation: 'read committed' },
  input: z.object({}),
  output: z.object({
    user: z.object({ id: idString(), displayName: z.string() }),
    permissions: permissionKeys, // the person's keys now, such as "sales:write"
    session: z.object({
      idleExpiresAt: momentString(), // moves forward on activity
      absoluteExpiresAt: momentString(), // never moves
    }),
    secondFactor: z.enum(['not_required', 'enrolled', 'enrolment_required']), // D-19: admin and owner only
  }),
});
