// The settings the api and worker read (ADR-004 §5), checked once at start (RAD-28, RC-081). A bad or missing setting
// stops the process with every problem named, never a half-safe start. Messages name the setting, never its value.
// The caller passes the environment in, so this reads nothing itself and tests need no process state.
import { z } from 'zod';

export type ProcessName = 'api' | 'worker';
const APP_ENVS = ['development', 'ci', 'review', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];
type Env = Record<string, string | undefined>;

const ALL = APP_ENVS;
const DEV_CI = ['development', 'ci'] as const;
const LOCAL_KEY_ENVS = ['development', 'ci', 'review'] as const;
const DEPLOYED = ['staging', 'production'] as const;

const url = (protocols: RegExp) => z.string().refine((v) => URL.canParse(v) && protocols.test(new URL(v).protocol),
  { message: `must be a ${protocols.source.replace(/[\^$:]/g, '')} URL` });
const positiveInt = z.string().regex(/^[1-9]\d*$/, 'must be a whole number above 0');
const ip = z.union([z.ipv4(), z.ipv6()]);
// Base64 or base64url of at least 32 random bytes (RC-213).
const localKey = z.string().refine((v) => /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length >= 32,
  { message: 'must be at least 32 random bytes, base64 encoded' });
const text = z.string().min(1);
/**
 * A multi-Region KMS key's full ARN (ADR-004 §4). The SDK's MRK-aware strict keyring encrypts with a bare `mrk-…` id
 * or an alias, but decrypts only when the configured id is the full ARN, so anything else would make every stored
 * secret unreadable (auditor-2, RAD-42).
 */
export const MULTI_REGION_KEY_ARN = /^arn:aws[a-z-]*:kms:[a-z]{2}(-[a-z]+)+-\d:\d{12}:key\/mrk-[0-9a-f]{32}$/;

// Each setting's format, and where it is required (ADR-004 §5's "Required in" and "Read by" columns).
const SETTINGS = {
  NODE_ENV: { format: z.enum(['development', 'test', 'production']), in: ALL },
  APP_ENV: { format: z.enum(APP_ENVS), in: ALL },
  PUBLIC_ORIGIN: { format: url(/^https?:$/).refine((v) => new URL(v).origin === v, { message: 'must be an origin only, like https://erp.example.in' }), in: ALL },
  TRUST_PROXY: { format: z.string().refine((v) => v.split(',').every((a) => ip.safeParse(a.trim()).success), { message: 'must be IP addresses, separated by commas' }), in: ALL, by: 'api' },
  DATABASE_URL: { format: url(/^postgres(ql)?:$/), in: ALL, secret: true },
  DB_POOL_MAX: { format: positiveInt, in: ALL },
  DB_POOL_WAIT_MS: { format: positiveInt, in: ALL },
  DB_STATEMENT_TIMEOUT_MS: { format: positiveInt, in: ALL },
  DB_LOCK_TIMEOUT_MS: { format: positiveInt, in: ALL },
  DB_IDLE_TX_TIMEOUT_MS: { format: positiveInt, in: ALL },
  S3_REGION: { format: text, in: ALL },
  S3_BUCKET_FILES: { format: text, in: ALL },
  S3_ENDPOINT: { format: url(/^https?:$/), in: DEV_CI },
  S3_ACCESS_KEY_ID: { format: text, in: DEV_CI },
  S3_SECRET_ACCESS_KEY: { format: text, in: DEV_CI, secret: true },
  SECRETS_KMS_KEY_ID: { format: z.string().regex(MULTI_REGION_KEY_ARN, 'must be a multi-Region KMS key ARN (…:key/mrk-…)'), in: DEPLOYED },
  SECRETS_LOCAL_KEY: { format: localKey, in: LOCAL_KEY_ENVS, secret: true },
  MAIL_FROM: { format: z.email(), in: DEPLOYED },
  TURNSTILE_SITE_KEY: { format: text, in: ALL, by: 'api' },
  TURNSTILE_SECRET: { format: text, in: DEPLOYED, by: 'api', secret: true },
  ALERT_WEBHOOK_URL: { format: url(/^https:$/), in: DEPLOYED, secret: true },
  HEARTBEAT_URL: { format: url(/^https:$/), in: DEPLOYED, by: 'worker', secret: true },
  LOG_LEVEL: { format: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']), in: ALL },
} satisfies Record<string, { format: z.ZodType<unknown, string>; in: readonly AppEnv[]; by?: ProcessName; secret?: true }>;
type Name = keyof typeof SETTINGS;

// A secret left at a placeholder is as good as none.
const PLACEHOLDER = /^(change[-_ ]?me|password|passw0rd|secret|test|example|dummy|default|admin|x+|0+)$/i;

export type Config = {
  process: ProcessName;
  nodeEnv: 'development' | 'test' | 'production';
  appEnv: AppEnv;
  publicOrigin: string;
  /** The addresses whose forwarded-for headers the api trusts; empty for the worker. */
  trustProxy: string[];
  database: { url: string; poolMax: number; poolWaitMs: number; statementTimeoutMs: number; lockTimeoutMs: number;
    idleTxTimeoutMs: number };
  s3: { region: string; bucket: string; endpoint: string | null; accessKeyId: string | null; secretAccessKey: string | null };
  /** Exactly one is set. */
  secrets: { kmsKeyId: string | null; localKey: string | null };
  mailFrom: string | null;
  turnstile: { siteKey: string | null; secret: string | null };
  alertWebhookUrl: string | null;
  heartbeatUrl: string | null;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
};

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Refusing to start: ${problems.length} setting problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Check every setting for `proc` and return them typed, or throw a ConfigError naming each problem. */
export function loadConfig(env: Env, proc: ProcessName): Config {
  const problems: string[] = [];
  const get = (name: Name | 'VERCEL'): string | null => (env[name] === undefined || env[name] === '' ? null : env[name]);
  const parsedAppEnv = z.enum(APP_ENVS).safeParse(get('APP_ENV'));
  // An unreadable APP_ENV is judged as production, the strictest.
  const appEnv: AppEnv = parsedAppEnv.success ? parsedAppEnv.data : 'production';
  const deployed = (DEPLOYED as readonly AppEnv[]).includes(appEnv);

  for (const [name, s] of Object.entries(SETTINGS) as [Name, (typeof SETTINGS)[Name]][]) {
    const value = get(name);
    const needed = (s.in as readonly AppEnv[]).includes(appEnv) && (!('by' in s) || s.by === proc);
    if (value === null) {
      if (needed) problems.push(`${name} is required when APP_ENV is ${appEnv}${'by' in s ? ` (read by ${s.by})` : ''}`);
      continue;
    }
    const result = s.format.safeParse(value);
    if (!result.success) problems.push(`${name} ${result.error.issues[0]?.message ?? 'is not valid'}`);
    else if ('secret' in s && PLACEHOLDER.test(value)) problems.push(`${name} is a placeholder, not a real secret`);
  }

  // ADR-004 §5 "Start-up refuses when", and §7 for the test copy.
  if ((get('SECRETS_KMS_KEY_ID') === null) === (get('SECRETS_LOCAL_KEY') === null)) {
    problems.push('exactly one of SECRETS_KMS_KEY_ID and SECRETS_LOCAL_KEY must be set');
  }
  if (deployed) {
    for (const name of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (get(name) !== null) problems.push(`${name} must not be set when APP_ENV is ${appEnv} (the instance role reaches S3)`);
    }
  }
  const devOrCi = (DEV_CI as readonly AppEnv[]).includes(appEnv);
  if (get('NODE_ENV') === 'production' && devOrCi) problems.push(`APP_ENV ${appEnv} can't run with NODE_ENV production`);
  // ADR-004 §5: NODE_ENV is production outside development and CI, so no library takes a development path there.
  if (get('NODE_ENV') !== 'production' && !devOrCi) problems.push(`NODE_ENV must be production when APP_ENV is ${appEnv}`);
  if (get('VERCEL') !== null && appEnv !== 'review') problems.push('on Vercel, APP_ENV must be review (sample data only)');
  const origin = get('PUBLIC_ORIGIN');
  if (origin !== null && !devOrCi && !origin.startsWith('https://')) {
    problems.push(`PUBLIC_ORIGIN must be https:// when APP_ENV is ${appEnv}`);
  }
  const db = get('DATABASE_URL');
  if (db !== null && URL.canParse(db)) {
    const u = new URL(db);
    if (deployed && u.searchParams.get('sslmode') !== 'verify-full') {
      problems.push(`DATABASE_URL must verify TLS (sslmode=verify-full) when APP_ENV is ${appEnv}`);
    }
    const password = decodeURIComponent(u.password);
    if (PLACEHOLDER.test(password)) problems.push('DATABASE_URL has a placeholder password');
    // CI's throwaway database uses trust auth; everywhere else the password is generated.
    if (appEnv !== 'ci' && password.length < 16) problems.push('DATABASE_URL needs a password of at least 16 characters');
  }
  if (problems.length > 0) throw new ConfigError(problems);

  const str = (name: Name): string => get(name) ?? '';
  const num = (name: Name): number => Number(get(name));
  return {
    process: proc,
    nodeEnv: str('NODE_ENV') as Config['nodeEnv'],
    appEnv,
    publicOrigin: str('PUBLIC_ORIGIN'),
    trustProxy: proc === 'api' ? str('TRUST_PROXY').split(',').map((a) => a.trim()) : [],
    database: { url: str('DATABASE_URL'), poolMax: num('DB_POOL_MAX'), poolWaitMs: num('DB_POOL_WAIT_MS'),
      statementTimeoutMs: num('DB_STATEMENT_TIMEOUT_MS'), lockTimeoutMs: num('DB_LOCK_TIMEOUT_MS'),
      idleTxTimeoutMs: num('DB_IDLE_TX_TIMEOUT_MS') },
    s3: { region: str('S3_REGION'), bucket: str('S3_BUCKET_FILES'), endpoint: get('S3_ENDPOINT'),
      accessKeyId: get('S3_ACCESS_KEY_ID'), secretAccessKey: get('S3_SECRET_ACCESS_KEY') },
    secrets: { kmsKeyId: get('SECRETS_KMS_KEY_ID'), localKey: get('SECRETS_LOCAL_KEY') },
    mailFrom: get('MAIL_FROM'),
    turnstile: { siteKey: get('TURNSTILE_SITE_KEY'), secret: get('TURNSTILE_SECRET') },
    alertWebhookUrl: get('ALERT_WEBHOOK_URL'),
    heartbeatUrl: get('HEARTBEAT_URL'),
    logLevel: str('LOG_LEVEL') as Config['logLevel'],
  };
}
