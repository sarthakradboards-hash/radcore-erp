// Settings the api and worker accept at start (ADR-004 §5), for tests: development values, overridable per test.
// Secret-like values are built at run time from repeated characters, so they pass the settings check's length rules
// yet look like no real key to the secret scanner (gitleaks) (RAD-28).
type Settings = Record<string, string | undefined>;

/** A database password the settings check accepts: 20 characters, not a placeholder. */
export const testPassword = (): string => 'p'.repeat(20);

/** A multi-Region KMS key ARN in the form production needs (ADR-004 §4), for a key that doesn't exist. */
/** A rate-limit HMAC key for tests (RAD-73): 32 bytes, base64url. */
export const testRateLimitKey = (): string => Buffer.alloc(32, 9).toString('base64url');
export const testKmsKeyArn = (): string => `arn:aws:kms:ap-south-1:${'1'.repeat(12)}:key/mrk-${'a'.repeat(32)}`;

/** Every setting a development api needs; `overrides` replace or remove (with `undefined`) single ones. */
export function testSettings(overrides: Settings = {}): Settings {
  return {
    NODE_ENV: 'development', APP_ENV: 'development', PUBLIC_ORIGIN: 'http://127.0.0.1:3000', TRUST_PROXY: '127.0.0.1',
    DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:5432/radcore`,
    DB_POOL_MAX: '2', DB_POOL_WAIT_MS: '2000', DB_STATEMENT_TIMEOUT_MS: '1000', DB_LOCK_TIMEOUT_MS: '1000',
    DB_IDLE_TX_TIMEOUT_MS: '1000', S3_REGION: 'us-east-1', S3_BUCKET_FILES: 'radcore-files',
    S3_ENDPOINT: 'http://127.0.0.1:8333', S3_ACCESS_KEY_ID: 'test-id', S3_SECRET_ACCESS_KEY: 's'.repeat(20),
    SECRETS_LOCAL_KEY: Buffer.alloc(32, 7).toString('base64url'), RATE_LIMIT_KEY: testRateLimitKey(),
    TURNSTILE_SITE_KEY: 'test-site', LOG_LEVEL: 'info',
    ...overrides,
  };
}

/** The same for APP_ENV production, as the server would hold them (KMS, no static S3 settings, TLS verified). */
export function testProductionSettings(overrides: Settings = {}): Settings {
  return testSettings({
    NODE_ENV: 'production', APP_ENV: 'production', PUBLIC_ORIGIN: 'https://erp.example.in',
    TRUST_PROXY: '172.30.0.2, 172.30.0.3',
    DATABASE_URL: `postgres://radcore_app:${testPassword()}@db.example.in:5432/radcore?sslmode=verify-full`,
    S3_REGION: 'ap-south-1', S3_ENDPOINT: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined,
    SECRETS_LOCAL_KEY: undefined, SECRETS_KMS_KEY_ID: testKmsKeyArn(), MAIL_FROM: 'erp@example.in',
    TURNSTILE_SECRET: 't'.repeat(24), ALERT_WEBHOOK_URL: 'https://alerts.example.in/hook',
    HEARTBEAT_URL: 'https://monitor.example.in/beat',
    ...overrides,
  });
}
