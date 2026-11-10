import type { Issue } from '@radcore/lib-common';

/** A field's form name for an issue path: ['lines', 0, 'qty'] is "lines.0.qty", as React Hook Form names it. */
const fieldName = (path: Issue['path']) => path.join('.');

/** Splits an error envelope's issues into those a mounted field can show and the rest, for the form's own alert. */
export function placeIssues(issues: readonly Issue[], mounted: ReadonlySet<string>) {
  const fields: { name: string; message: string }[] = [];
  const rest: string[] = [];
  for (const i of issues) {
    const name = fieldName(i.path);
    // A field shows its first problem; the next one appears once that is fixed.
    if (!mounted.has(name)) rest.push(i.message);
    else if (!fields.some((f) => f.name === name)) fields.push({ name, message: i.message });
  }
  return { fields, rest };
}

/** The check's errors that no mounted field shows (a schema that requires a masked or missing field), as
 * "name: message", so the form can say why it won't save instead of doing nothing. */
export function unshownErrors(errors: object, mounted: ReadonlySet<string>, path: string[] = []): string[] {
  return Object.entries(errors).flatMap(([key, error]: [string, unknown]) => {
    if (error === null || typeof error !== 'object') return [];
    const name = [...path, key];
    if (!('message' in error) || typeof error.message !== 'string') return unshownErrors(error, mounted, name);
    return mounted.has(name.join('.')) ? [] : [`${name.join('.')}: ${error.message}`];
  });
}

/** A copy of `values` without the fields at `names`, so a masked value is never validated or sent (ADR-001 §7a). */
export function omitFields<T>(values: T, names: Iterable<string>): T {
  let out: unknown = values;
  for (const name of names) out = omit(out, name.split('.'));
  return out as T;
}

function omit(value: unknown, [key, ...more]: string[]): unknown {
  if (key === undefined || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return value;
  const copy: Record<string, unknown> = Array.isArray(value) ? [...value] as unknown as Record<string, unknown> : { ...value };
  if (more.length === 0) delete copy[key];
  else copy[key] = omit(copy[key], more);
  return copy;
}
