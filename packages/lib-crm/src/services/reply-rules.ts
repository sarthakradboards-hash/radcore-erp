// A quick reply's placeholders (M3-06, RAD-110): plain text filled in as the reply is drawn for a lead, never markup.
// The screen opens WhatsApp with the result; nothing is sent from here (the send waits for RAD-108's consent). Pure,
// so its unit tests reach every branch and Stryker can judge them.

type Key = 'name' | 'first_name' | 'owner';
/** The placeholders a quick reply may use, each with the space before it if there is one. */
const PLACEHOLDER = / ?\{(name|first_name|owner)\}/g;

/**
 * The reply's text for a lead: `{name}` its name, `{first_name}` the name's first word, `{owner}` its owner's name. One
 * with nothing to fill it is left out with the space before it ("Hi {first_name}, …" reads "Hi, …"). Anything else in
 * braces stays as written. One pass over the body, so a filled value is never read as a placeholder itself.
 */
export function fillReply(body: string, lead: { name: string | null; owner: string | null }): string {
  const name = lead.name?.trim() ?? '';
  const values: Record<Key, string> = { name, first_name: String(name.split(/\s/, 1)), owner: lead.owner?.trim() ?? '' };
  return body.replace(PLACEHOLDER, (match, key: Key) => {
    const value = values[key];
    // An empty one goes with the space before it, so no gap or stray space before punctuation is left.
    return value === '' ? '' : `${match.startsWith(' ') ? ' ' : ''}${value}`;
  });
}
