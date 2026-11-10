// TEMPORARY copy of getMe from backend-2's PR #66 (packages/lib-platform/src/contract.ts at 07a8c0d), so RAD-50
// part 2 can be built before #66 lands. Once it's on dev: delete this file, add @radcore/lib-platform to apps/web's
// dependencies, and import { getMe } from '@radcore/lib-platform/contract' instead. Keep it identical until then.
import { defineContract, idString, momentString } from '@radcore/lib-common';
import { z } from 'zod';

const permissionKeys = z.array(z.string()).refine((keys) => keys.every((k, i) => i === 0 || (keys[i - 1] ?? '') < k),
  { error: 'Permission keys are sorted and appear once each' });

export const getMe = defineContract({
  method: 'GET', path: '/me', auth: 'session',
  perm: 'session:read',
  tx: { readOnly: true, isolation: 'read committed' },
  input: z.object({}),
  output: z.object({
    user: z.object({ id: idString(), displayName: z.string() }),
    permissions: permissionKeys,
    session: z.object({ idleExpiresAt: momentString(), absoluteExpiresAt: momentString() }),
    secondFactor: z.enum(['not_required', 'enrolled', 'enrolment_required']),
  }),
});
