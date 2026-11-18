// The people the journeys sign in as (RAD-58). They are written straight into the e2e database as its superuser,
// because inviting them through the app would need the mail outbox; their password is new each run. Signing in is
// never faked: it goes through the api, with the authenticator (D-19) enrolled and answered like a phone would.
// - global-setup.ts seeds one person per built-in role and saves each one's signed-in browser state (`stateFor`).
// - A journey that changes someone (enrols them, locks them out, revokes their role) seeds its own with `seedPerson`,
//   so engines, retries and reruns never share one.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request, type APIRequestContext } from '@playwright/test';
import { Secret, TOTP, URI } from 'otpauth';
import pg from 'pg';
import { createPasswords } from '../packages/lib-platform/src/auth/passwords.ts';

/** The e2e database as its superuser: only the seeding here uses it, never the app. */
const SEED_DATABASE_URL = process.env['E2E_SEED_DATABASE_URL'] ?? 'postgres://radcore@127.0.0.1:5432/radcore_e2e';
/** Per run, git-ignored: the password, each person's authenticator secret and signed-in state. */
const AUTH_DIR = fileURLToPath(new URL('./.auth/', import.meta.url));
const file = (name: string) => `${AUTH_DIR}${name}`;

export type Person = { id: string; email: string; name: string; role: string };

/** The password every seeded person has this run (global-setup.ts writes it). */
export const password = (): string => readFileSync(file('password.txt'), 'utf8').trim();
export function newPassword(): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(file('password.txt'), randomBytes(18).toString('base64url'));
}

let passwords: ReturnType<typeof createPasswords> | undefined;

async function withDb<T>(work: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: SEED_DATABASE_URL });
  await db.connect();
  try {
    await db.query('begin');
    // Every write to an audited table names who made it (the audit trigger refuses one that doesn't).
    await db.query("select set_config('app.principal', 'system:e2e-seed', true)");
    const result = await work(db);
    await db.query('commit');
    return result;
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

/** Every built-in role, as the database has them. */
export const builtInRoles = (): Promise<{ key: string; name: string }[]> => withDb(async (db) =>
  (await db.query<{ key: string; name: string }>(
    'select key, name from radcore.roles where key in (select role from radcore.role_templates) order by key')).rows);

/**
 * An active person with `role` and this run's password, and no authenticator yet. An existing address is reset to
 * that state, so a rerun starts clean. Without `email`, a new address unique to this call.
 */
export async function seedPerson(role: string, { email, name }: { email?: string; name?: string } = {}): Promise<Person> {
  const address = email ?? `${role}-${randomUUID().slice(0, 8)}@e2e.test`;
  const display = name ?? `E2E ${role} ${address.split('@')[0]}`;
  passwords ??= createPasswords();
  const hash = await (await passwords).hash(password());
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into radcore.users (email, display_name, password_hash, password_set_at, status, role)
       values ($1, $2, $3, now(), 'active', $4)
       on conflict (email_key) do update set display_name = excluded.display_name, password_hash = excluded.password_hash,
         password_set_at = now(), status = 'active', role = excluded.role
       returning id`, [address, display, hash, role]);
    const id = rows[0]!.id;
    await db.query('delete from radcore.recovery_codes where user_id = $1', [id]);
    await db.query('delete from radcore.second_factors where user_id = $1', [id]);
    await db.query('update radcore.sessions set ended_at = now(), ended_reason = $2 where user_id = $1 and ended_at is null', [id, 'sign_out']);
    rmIfExists(secretFile(address));
    return { id, email: address, name: display, role };
  });
}

const secretFile = (email: string) => file(`totp-${email}.txt`);
function rmIfExists(path: string) {
  if (existsSync(path)) writeFileSync(path, '');
}

/** Keeps a person's authenticator secret, as their phone would. */
export const rememberSecret = (email: string, otpauthUri: string): void => {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(secretFile(email), (URI.parse(otpauthUri) as TOTP).secret.base32);
};

/**
 * The code their phone shows now. The api accepts each 30-second step once per person, so when this person's last
 * code was from this step, it waits for the next one.
 */
export async function codeFor(email: string): Promise<string> {
  const base32 = existsSync(secretFile(email)) ? readFileSync(secretFile(email), 'utf8').trim() : '';
  if (base32 === '') throw new Error(`${email} has no authenticator yet`);
  const totp = new TOTP({ secret: Secret.fromBase32(base32), algorithm: 'SHA1', digits: 6, period: 30 });
  const usedFile = file(`step-${email}.txt`);
  const step = () => Math.floor(Date.now() / 30_000);
  const used = existsSync(usedFile) ? Number(readFileSync(usedFile, 'utf8')) : -1;
  while (step() <= used) await new Promise((r) => setTimeout(r, 500));
  writeFileSync(usedFile, String(step()));
  return totp.generate();
}

/**
 * Signs `email` in through the api, the way the sign-in screen does, enrolling or answering the authenticator as the
 * role requires. Returns a request context holding the session cookie (and the browser state to save from it).
 */
export async function apiSignIn(baseURL: string, email: string): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: new URL(baseURL).origin } });
  const post = async (path: string, data: unknown, headers: Record<string, string> = {}) => {
    const res = await api.post(`/api${path}`, { data, headers });
    if (!res.ok()) throw new Error(`POST ${path} for ${email}: ${res.status()} ${await res.text()}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const first = await post('/sign-in', { email, password: password() });
  if (first['next'] === 'enrol_second_factor') {
    const { otpauthUri } = await post('/sign-in/second-factor/enrolment', {}, { 'idempotency-key': randomUUID() });
    rememberSecret(email, String(otpauthUri));
    await post('/sign-in/second-factor/enrolment/confirm', { code: await codeFor(email) });
  } else if (first['next'] === 'second_factor') {
    await post('/sign-in/second-factor', { kind: 'totp', code: await codeFor(email) });
  }
  return api;
}

/** Where global-setup.ts saved the signed-in browser state of the seeded person with `role`. */
export const stateFor = (role: string): string => file(`state-${role}.json`);
/** The address of the seeded person with `role`. */
export const roleEmail = (role: string): string => `${role}@e2e.test`;
