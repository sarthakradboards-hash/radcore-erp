// An error as a log line may carry it (RC-007). Drizzle's query error says "Failed query: <sql>\nparams: <every bound
// value>", and PostgreSQL's `detail` repeats the row ("Key (phone)=(98765...)"). So the description keeps what
// happened and where: the class, the PostgreSQL code, table, column, constraint and routine. The message is cut
// before any SQL and scrubbed; `detail`, `where`, the SQL and its params are never kept.
import { scrubText } from './scrub.ts';

export type ErrorDescription = {
  name: string;
  message: string;
  code?: string;
  table?: string;
  column?: string;
  constraint?: string;
  routine?: string;
  /** The stack's frames only: its first line repeats the message. */
  stack?: string;
};

const JSON_MESSAGE = 'The text is not valid JSON';
// Messages that carry their input without quotes (Node 26 and decimal.js, as each writes them). The input goes, the
// rest of the message stays.
const UNQUOTED: [RegExp, string][] = [
  [/^\[DecimalError\] ([^:\n]*): [\s\S]*$/, '[DecimalError] $1: …'],
  [/^Cannot convert [\s\S]* to a BigInt$/, 'Cannot convert … to a BigInt'],
  [/^Invalid regular expression: [\s\S]*: ([^:\n]*)$/, 'Invalid regular expression: /…/: $1'],
  [/^Invalid time zone specified: [\s\S]*$/, 'Invalid time zone specified: …'],
  [/^Unknown encoding: [\s\S]*$/, 'Unknown encoding: …'],
  [/^[\s\S]* could not be cloned\.$/, '… could not be cloned.'],
];
const PG_FIELDS = ['code', 'table', 'column', 'constraint', 'routine'] as const;
const field = (o: object, k: string): string | undefined => {
  const v: unknown = (o as Record<string, unknown>)[k];
  return typeof v === 'string' && v !== '' ? v : undefined;
};

/** The PostgreSQL error inside an error and its causes: the first one that has a five-character SQLSTATE code. */
function pgError(err: unknown): object | undefined {
  for (let e: unknown = err, hops = 0; e !== null && typeof e === 'object' && hops < 5; hops++) {
    const code = field(e, 'code');
    if (code !== undefined && /^[0-9A-Z]{5}$/.test(code)) return e;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** What a log line, the error log or an alert may say about an error. */
export function describeError(err: unknown): ErrorDescription {
  const name = err instanceof Error ? err.name : typeof err;
  const raw = err instanceof Error ? err.message : String(err);
  // "Failed query: insert into ..." is Drizzle; a statement's text is never logged, only that a query failed.
  // A quoted span is the input being complained about: PostgreSQL's 22P02 (`invalid input syntax for type integer:
  // "Asha Rao"`) and JSON.parse (`"Asha Rao 98..." is not valid JSON`). The shape stays, the value goes.
  const cut = /^Failed query:/.test(raw) ? 'Failed query' : raw.split(/\r?\n\s*params:/)[0] ?? '';
  // JSON.parse's messages quote the body they failed on, so they're replaced whole rather than masked.
  const json = err instanceof SyntaxError && /\bJSON\b/.test(raw);
  const unquoted = UNQUOTED.reduce((m, [shape, keep]) => m.replace(shape, keep), cut);
  const message = json ? JSON_MESSAGE : scrubText(unquoted.replace(/"[^"\n]*"|'[^'\n]*'/g, '"…"'));
  const out: ErrorDescription = { name, message };
  const pg = pgError(err);
  if (pg) for (const k of PG_FIELDS) { const v = field(pg, k); if (v !== undefined) out[k] = v; }
  if (err instanceof Error && err.stack) {
    const frames = err.stack.split('\n').filter((l) => /^\s+at /.test(l)).join('\n');
    if (frames) out.stack = frames;
  }
  return out;
}
