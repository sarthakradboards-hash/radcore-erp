// A quick reply's placeholders (M3-06, RAD-110): plain text filled in as the reply is drawn for a lead, never markup.
// The screen opens WhatsApp with the result; nothing is sent from here (the send waits for RAD-108's consent). Pure,
// so its unit tests reach every branch and Stryker can judge them.

/** The placeholders a quick reply may use, and what fills each. */
export const PLACEHOLDERS = ['{name}', '{first_name}', '{owner}'] as const;

/**
 * The reply's text for a lead: `{name}` its name, `{first_name}` the name's first word, `{owner}` its owner's name. One
 * with nothing to fill it is left out, and the space or comma it leaves behind with it ("Hi {first_name}, …" reads
 * "Hi, …"). Anything else in braces stays as written.
 */
export function fillReply(body: string, lead: { name: string | null; owner: string | null }): string {
  const name = lead.name?.trim() ?? '';
  const values: Record<(typeof PLACEHOLDERS)[number], string> = {
    '{name}': name, '{first_name}': name.split(/\s+/)[0] ?? '', '{owner}': lead.owner?.trim() ?? '',
  };
  let text = body;
  for (const p of PLACEHOLDERS) {
    const value = values[p];
    // An empty one goes with the space before it, so no gap or stray space before punctuation is left.
    text = value === '' ? text.split(` ${p}`).join('').split(p).join('') : text.split(p).join(value);
  }
  return text;
}
