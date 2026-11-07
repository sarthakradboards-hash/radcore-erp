// Structured logs (RC-077): pino's JSON lines with a level, a time, the service and, inside a request or a job, its
// request id. Every message is scrubbed, known secret keys are redacted, and errors go through describeError, so no
// line carries personal data, a token or a failed query's values (RC-007). The process writes to stdout; the host
// ships it (ADR-004).
import { pino, type DestinationStream, type Level } from 'pino';
import { describeError } from './safe-error.ts';
import { REDACT_PATHS, scrubText } from './scrub.ts';

/** Fields to add to a line. Anything at a secret key is redacted. */
export type Fields = Record<string, unknown>;

/** The logger the API, the worker and the platform pieces take. It fits RAD-28's Logger: info(m) and error(m, err). */
export interface Log {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, err?: unknown, fields?: Fields): void;
  /** A logger whose every line also carries these fields, such as `{ requestId }` for one request. */
  child(fields: Fields): Log;
}

export type LogOptions = {
  /** LOG_LEVEL from settings (ADR-004). */
  level: Level | 'silent';
  /** "api" or "worker". */
  service: string;
  /** For tests; stdout otherwise. */
  destination?: DestinationStream;
};

type Pino = pino.Logger;

function wrap(p: Pino): Log {
  return {
    debug: (m, f) => p.debug(f ?? {}, scrubText(m)),
    info: (m, f) => p.info(f ?? {}, scrubText(m)),
    warn: (m, f) => p.warn(f ?? {}, scrubText(m)),
    error: (m, err, f) => p.error(err === undefined ? (f ?? {}) : { ...f, err }, scrubText(m)),
    child: (f) => wrap(p.child(f)),
  };
}

export function createLog(o: LogOptions): Log {
  const options: pino.LoggerOptions = {
    level: o.level,
    base: { service: o.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    // Every error, however it reaches a line, is described, never dumped.
    serializers: { err: describeError, error: describeError },
    // shortcut: string fields are scrubbed one level deep; a nested object's strings rely on the redact keys.
    formatters: { log: (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) =>
      [k, typeof v === 'string' ? scrubText(v) : v])) },
  };
  return wrap(o.destination ? pino(options, o.destination) : pino(options));
}
