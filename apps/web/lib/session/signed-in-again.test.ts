import { expect, it } from 'vitest';
import { afterSignInAgain } from './signed-in-again.ts';

it('keeps the page only when the same person signs back in', () => {
  expect(afterSignInAgain('u-asha', 'u-asha')).toBe('keep');
  expect(afterSignInAgain('u-asha', 'u-ravi')).toBe('reload');
  // Nobody was known on this page (no shell session in the cache): a full load is the safe answer.
  expect(afterSignInAgain(undefined, 'u-asha')).toBe('reload');
});
