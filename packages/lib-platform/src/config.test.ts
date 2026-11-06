// RC-081: nothing validated configuration at start. Each case is one setting problem the process must refuse.
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type ProcessName } from './index.ts';

const KEY = Buffer.alloc(32, 7).toString('base64url');
const PG_PASSWORD = 'Zq3vR8kLm2Xp9TfW4yHs';
const dev = (): Record<string, string | undefined> => ({
  NODE_ENV: 'development', APP_ENV: 'development', PUBLIC_ORIGIN: 'http://127.0.0.1:3000', TRUST_PROXY: '127.0.0.1',
  DATABASE_URL: `postgres://radcore:${PG_PASSWORD}@127.0.0.1:5432/radcore`, DB_POOL_MAX: '10', DB_POOL_WAIT_MS: '2000',
  DB_STATEMENT_TIMEOUT_MS: '15000', DB_LOCK_TIMEOUT_MS: '5000', DB_IDLE_TX_TIMEOUT_MS: '10000', S3_REGION: 'us-east-1',
  S3_BUCKET_FILES: 'radcore-files', S3_ENDPOINT: 'http://127.0.0.1:8333', S3_ACCESS_KEY_ID: 'AKIA0000000000000000',
  S3_SECRET_ACCESS_KEY: 'k3N9vQ2xR7mT4pW8zY1s', SECRETS_LOCAL_KEY: KEY, TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  LOG_LEVEL: 'info',
});
const production = (): Record<string, string | undefined> => ({
  ...dev(), NODE_ENV: 'production', APP_ENV: 'production', PUBLIC_ORIGIN: 'https://erp.radboards.in',
  TRUST_PROXY: '172.30.0.2, 172.30.0.3',
  DATABASE_URL: `postgres://radcore_app:${PG_PASSWORD}@db.ap-south-1.rds.amazonaws.com:5432/radcore?sslmode=verify-full`,
  S3_REGION: 'ap-south-1', S3_ENDPOINT: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined,
  SECRETS_LOCAL_KEY: undefined, SECRETS_KMS_KEY_ID: 'mrk-1234abcd', MAIL_FROM: 'erp@radboards.in',
  TURNSTILE_SECRET: '0x4AAAAAAAk9Rz7q2Wm', ALERT_WEBHOOK_URL: 'https://hooks.example.in/T0/abc',
  HEARTBEAT_URL: 'https://monitor.example.in/hb/xyz',
});
const attempt = (env: Record<string, string | undefined>, proc: ProcessName): unknown => {
  try {
    loadConfig(env, proc);
    return null;
  } catch (e) {
    return e;
  }
};
// Anything thrown other than a ConfigError shows up as a problem, so a test can't pass on the wrong error.
const problems = (env: Record<string, string | undefined>, proc: ProcessName = 'api'): string[] => {
  const e = attempt(env, proc);
  return e instanceof ConfigError ? e.problems : e === null ? [] : [`unexpected: ${String(e)}`];
};

describe('accepts complete settings', () => {
  it('for development, typed', () => {
    const c = loadConfig(dev(), 'api');
    expect(c.appEnv).toBe('development');
    expect(c.trustProxy).toEqual(['127.0.0.1']);
    expect(c.database).toEqual({ url: dev()['DATABASE_URL'], poolMax: 10, poolWaitMs: 2000, statementTimeoutMs: 15000,
      lockTimeoutMs: 5000, idleTxTimeoutMs: 10000 });
    expect(c.secrets).toEqual({ kmsKeyId: null, localKey: KEY });
  });

  it.each(['api', 'worker'] as const)('for production, as %s', (proc) => {
    expect(problems(production(), proc)).toEqual([]);
    expect(loadConfig(production(), proc).trustProxy).toEqual(proc === 'api' ? ['172.30.0.2', '172.30.0.3'] : []);
  });

  it('for CI, whose throwaway database has no password', () => {
    expect(problems({ ...dev(), APP_ENV: 'ci', NODE_ENV: 'test', DATABASE_URL: 'postgres://radcore@127.0.0.1:5432/radcore' }))
      .toEqual([]);
  });
});

describe('refuses to start', () => {
  it('naming every missing setting at once', () => {
    const got = problems({});
    for (const name of ['NODE_ENV', 'APP_ENV', 'PUBLIC_ORIGIN', 'TRUST_PROXY', 'DATABASE_URL', 'DB_POOL_MAX', 'LOG_LEVEL',
      'SECRETS_KMS_KEY_ID', 'MAIL_FROM', 'TURNSTILE_SECRET', 'ALERT_WEBHOOK_URL']) {
      expect(got.join('\n')).toContain(`${name} is required`);
    }
  });

  it('judging an unknown APP_ENV as production, the strictest', () => {
    const got = problems({ ...dev(), APP_ENV: 'prod' }).join('\n');
    expect(got).toContain('APP_ENV Invalid option');
    expect(got).toContain('MAIL_FROM is required when APP_ENV is production');
  });

  it.each([
    ['DB_POOL_MAX', '0', 'whole number'],
    ['DB_STATEMENT_TIMEOUT_MS', '1.5', 'whole number'],
    ['PUBLIC_ORIGIN', 'http://127.0.0.1:3000/app', 'origin only'],
    ['TRUST_PROXY', '127.0.0.1, proxy', 'IP addresses'],
    ['DATABASE_URL', 'mysql://x:y@h/db', 'URL'],
    ['LOG_LEVEL', 'verbose', 'LOG_LEVEL'],
    ['SECRETS_LOCAL_KEY', Buffer.alloc(16, 7).toString('base64url'), 'at least 32 random bytes'],
    ['S3_SECRET_ACCESS_KEY', 'changeme', 'placeholder'],
    ['DATABASE_URL', 'postgres://radcore:password@127.0.0.1:5432/radcore', 'placeholder password'],
    ['DATABASE_URL', 'postgres://radcore:short@127.0.0.1:5432/radcore', 'at least 16 characters'],
  ])('on a bad %s (%s)', (name, value, why) => {
    expect(problems({ ...dev(), [name]: value }).join('\n')).toContain(why);
  });

  it.each([
    [{ SECRETS_KMS_KEY_ID: 'mrk-1' }, 'exactly one of SECRETS_KMS_KEY_ID and SECRETS_LOCAL_KEY'],
    [{ SECRETS_LOCAL_KEY: undefined }, 'exactly one of SECRETS_KMS_KEY_ID and SECRETS_LOCAL_KEY'],
    [{ NODE_ENV: 'production', APP_ENV: 'ci' }, "APP_ENV ci can't run with NODE_ENV production"],
    [{ VERCEL: '1' }, 'on Vercel, APP_ENV must be review'],
  ])('in development on %j', (change, why) => {
    expect(problems({ ...dev(), ...change }).join('\n')).toContain(why);
  });

  it.each([
    [{ S3_ENDPOINT: 'http://127.0.0.1:8333' }, 'S3_ENDPOINT must not be set'],
    [{ S3_ACCESS_KEY_ID: 'AKIA0000000000000000' }, 'S3_ACCESS_KEY_ID must not be set'],
    [{ DATABASE_URL: `postgres://radcore_app:${PG_PASSWORD}@db.rds.amazonaws.com/radcore?sslmode=require` }, 'sslmode=verify-full'],
    [{ PUBLIC_ORIGIN: 'http://erp.radboards.in' }, 'PUBLIC_ORIGIN must be https://'],
    [{ ALERT_WEBHOOK_URL: 'http://hooks.example.in/T0' }, 'ALERT_WEBHOOK_URL must be a https URL'],
    [{ TURNSTILE_SECRET: 'secret' }, 'TURNSTILE_SECRET is a placeholder'],
  ])('in production on %j', (change, why) => {
    expect(problems({ ...production(), ...change }).join('\n')).toContain(why);
  });

  it('asks each process only for what it reads', () => {
    expect(problems({ ...production(), HEARTBEAT_URL: undefined }, 'api')).toEqual([]);
    expect(problems({ ...production(), HEARTBEAT_URL: undefined }, 'worker')).toEqual(['HEARTBEAT_URL is required when APP_ENV is production (read by worker)']);
    expect(problems({ ...production(), TRUST_PROXY: undefined, TURNSTILE_SECRET: undefined }, 'worker')).toEqual([]);
  });

  it('never puts a secret value in its message', () => {
    const env = { ...production(), S3_ENDPOINT: 'http://127.0.0.1:8333', SECRETS_LOCAL_KEY: KEY,
      DATABASE_URL: `postgres://radcore_app:${PG_PASSWORD}@db.rds.amazonaws.com/radcore`, TURNSTILE_SECRET: 'changeme' };
    const e = attempt(env, 'api');
    expect(e).toBeInstanceOf(ConfigError);
    const message = String(e);
    expect(message).toContain('Refusing to start');
    for (const value of [PG_PASSWORD, KEY, 'changeme']) expect(message).not.toContain(value);
  });
});
