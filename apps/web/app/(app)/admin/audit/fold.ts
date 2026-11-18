// Where a long reason folds on the audit trail (RAD-57). It folds at the last space before SHORT_REASON characters,
// so no word is split; that space becomes a non-breaking one at the end of the summary, because Chromium and Firefox
// drop a plain space between the summary and the body when the reason opens, and a screen reader then hears the two
// words joined ("Theregistered", e2e on #196). A reason with no space that early is cut at SHORT_REASON, inside a word,
// which reads back joined, as it should.
export const SHORT_REASON = 140;

/** The summary and the rest of a reason longer than SHORT_REASON, or null for one short enough to show whole. */
export function foldReason(text: string): { start: string; rest: string } | null {
  if (text.length <= SHORT_REASON) return null;
  let space = -1;
  for (let i = SHORT_REASON; i > 0; i--) {
    if (/\s/.test(text.charAt(i))) { space = i; break; }
  }
  if (space === -1) return { start: text.slice(0, SHORT_REASON), rest: text.slice(SHORT_REASON) };
  return { start: `${text.slice(0, space)} `, rest: text.slice(space + 1) };
}
