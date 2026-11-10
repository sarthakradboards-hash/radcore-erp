// RC-214 (RAD-50): the signed-in shell reads the session in app/(app)/layout.tsx before the first byte. A loading.tsx
// (or the Suspense it creates) at the app root would wrap that layout, so the page would stream "Loading…" before the
// session read and a signed-out redirect would become a client-side one. Loading screens live inside a route group.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const APP = 'apps/web/app';

it('has no loading screen at the app root', () => {
  expect(readdirSync(APP).filter((f) => /^loading\.(tsx?|jsx?)$/.test(f))).toEqual([]);
});

it('keeps the signed-in loading screen inside (app)', () => {
  expect(existsSync(join(APP, '(app)', 'loading.tsx'))).toBe(true);
});
