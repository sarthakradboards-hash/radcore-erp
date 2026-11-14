// A role's unsaved permission changes, kept as the person's own ticks and unticks rather than a whole grant set
// (the auditor on #145). Laid over whatever the server last sent, so after matrix_changed reloads it, another admin's
// change stays as they saved it and only this person's own choices differ.
export type GrantEdits = ReadonlyMap<string, boolean>;

/** The grants as the person sees them: the saved ones, with their ticks added and their unticks taken away. */
export function withEdits(saved: ReadonlySet<string>, edits: GrantEdits): Set<string> {
  const shown = new Set(saved);
  for (const [key, wanted] of edits) {
    if (wanted) shown.add(key);
    else shown.delete(key);
  }
  return shown;
}

/** The edits after the person flips `key`; flipping it back to what is saved forgets the edit. */
export function flip(saved: ReadonlySet<string>, edits: GrantEdits, key: string): GrantEdits {
  const wanted = !withEdits(saved, edits).has(key);
  const next = new Map(edits);
  if (wanted === saved.has(key)) next.delete(key);
  else next.set(key, wanted);
  return next;
}
