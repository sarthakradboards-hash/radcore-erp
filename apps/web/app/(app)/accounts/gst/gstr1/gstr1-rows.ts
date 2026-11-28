// What the GSTR-1 screen shapes for its tables (RAD-169 on RAD-154's getGstr1): a document becomes one row per GST rate, as
// the portal lists it, with the document's own fields on its first row only. Every figure is the server's; nothing is added.

/** One row of a document table: the document, one of its rate items (none for a document with no items), and whether
 * it's the document's first row. */
export type RateRow<D, I> = { key: string; doc: D; item: I | null; first: boolean };

export function byRate<D extends { number: string | null; date: string; items: readonly unknown[] }>(docs: readonly D[]): RateRow<D, D['items'][number]>[] {
  return docs.flatMap((doc, d) => {
    const base = `${d}-${doc.number ?? ''}-${doc.date}`;
    if (doc.items.length === 0) return [{ key: base, doc, item: null, first: true }];
    return doc.items.map((item, i) => ({ key: `${base}-${i}`, doc, item, first: i === 0 }));
  });
}

/** The month before today's, as YYYY-MM: the return usually worked on. `today` is an India date, YYYY-MM-DD. */
export function lastMonth(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}
