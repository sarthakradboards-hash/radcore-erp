import { expect, it } from 'vitest';
import { foldReason, SHORT_REASON } from './fold.ts';

const words = (s: string) => s.replace(/ /g, ' ').split(/\s+/).filter(Boolean);

it('leaves a reason of up to 140 characters whole', () => {
  expect(foldReason('a'.repeat(SHORT_REASON))).toBeNull();
});

it('folds at the last space before 140, ending the summary with a non-breaking space, so no two words run together', () => {
  const text = `${'word '.repeat(27)}The registered dealer asked for the change.`; // 135 + "The…", a space near the cut
  const fold = foldReason(text);
  expect(fold).not.toBeNull();
  expect(fold?.start.endsWith(' ')).toBe(true);
  expect(fold?.start.length).toBeLessThanOrEqual(SHORT_REASON + 1);
  // What a screen reader reads once the reason is open: the summary then the body, nothing added, nothing joined.
  expect(words(`${fold?.start}${fold?.rest}`)).toEqual(words(text));
});

it('a cut that would land on a space keeps the words apart (the e2e case: "The|registered")', () => {
  const text = `${'x'.repeat(136)} The registered dealer.`; // index 140 is the space before "registered"
  const fold = foldReason(text);
  expect(`${fold?.start}${fold?.rest}`.replace(/ /g, ' ')).toBe(text);
  expect(`${fold?.start}${fold?.rest}`).not.toContain('Theregistered');
});

it('cuts a reason with no early space at 140, inside its long word, which reads back joined', () => {
  const text = `${'x'.repeat(200)} end`;
  expect(foldReason(text)).toEqual({ start: 'x'.repeat(SHORT_REASON), rest: `${'x'.repeat(60)} end` });
});
