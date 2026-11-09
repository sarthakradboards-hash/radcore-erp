// The fields of a log line, made safe at any depth (RC-007): every error described, every key that names personal
// data or a secret redacted, every other string scrubbed. Arrays are walked like objects.
import { describeError } from './safe-error.ts';
import { scrubText } from './scrub.ts';

// A key is redacted when one of its words (split on camelCase, snake_case, kebab-case and dots) is one of these:
// leadName, customer_phone, emailAddress, bankAccountNumber and dateOfBirth all are; companyId and panel aren't.
const SENSITIVE = new Set(['name', 'phone', 'mobile', 'email', 'pan', 'gstin', 'aadhaar', 'account', 'ifsc', 'address',
  'salary', 'dob', 'birth', 'upi', 'password', 'passwd', 'token', 'secret', 'otp', 'cookie', 'authorization', 'auth']);
// Keys that carry what a line is for, never personal data.
const SAFE = new Set(['service', 'route', 'requestId', 'method', 'status', 'code', 'table', 'column', 'constraint',
  'routine', 'level', 'time', 'msg']);
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_.\-]+/);
const sensitive = (key: string) => !SAFE.has(key) && words(key).some((w) => SENSITIVE.has(w));

/** A value as a log line may carry it. */
function safeValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return describeError(value);
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => safeValue(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `[${value.length - MAX_ITEMS} more]`] : items;
  }
  return safeFields(value as Record<string, unknown>, depth);
}

/** An object's fields as a log line may carry them. */
export function safeFields(fields: Record<string, unknown>, depth = 0): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).slice(0, MAX_ITEMS).map(([k, v]) =>
    [k, sensitive(k) ? '[redacted]' : safeValue(v, depth + 1)]));
}
