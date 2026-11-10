// RAD-24: a login's password reaches PostgreSQL only as a SCRAM-SHA-256 verifier, so no plain password lands in the
// server's statement log. This checks the verifier with node-postgres's own SCRAM client: a client that knows the
// password proves itself against the stored key, and accepts the server's signature made with the server key.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { scramVerifier } from './db-logins.ts';

type Session = { clientNonce: string; response: string };
// node-postgres ships no types for its SCRAM helpers; they're the independent client here.
const client = createRequire(import.meta.url)('pg/lib/crypto/sasl') as {
  startSession: (mechanisms: string[]) => Session;
  continueSession: (s: Session, password: string, serverData: string) => Promise<void>;
  finalizeSession: (s: Session, serverData: string) => void;
};

// Plays the server's side of one exchange with a verifier's keys: does the client's proof match the stored key, and
// does the client accept the server's signature?
async function signIn(verifier: string, tried: string): Promise<{ proof: boolean; server: boolean }> {
  const [, salt = '', stored = '', serverKey = ''] = /^SCRAM-SHA-256\$4096:(.+)\$(.+):(.+)$/.exec(verifier) ?? [];
  const s = client.startSession(['SCRAM-SHA-256']);
  const clientFirst = s.response.replace(/^n,,/, '');
  const serverFirst = `r=${s.clientNonce}${randomBytes(18).toString('base64')},s=${salt},i=4096`;
  await client.continueSession(s, tried, serverFirst);
  const auth = `${clientFirst},${serverFirst},${s.response.replace(/,p=[^,]*$/, '')}`;
  const proof = Buffer.from(/,p=([^,]*)$/.exec(s.response)?.[1] ?? '', 'base64');
  const signature = createHmac('sha256', Buffer.from(stored, 'base64')).update(auth).digest();
  const clientKey = Buffer.from(proof.map((b, i) => b ^ (signature[i] ?? 0)));
  const serverSignature = createHmac('sha256', Buffer.from(serverKey, 'base64')).update(auth).digest('base64');
  let server = true;
  try {
    client.finalizeSession(s, `v=${serverSignature}`);
  } catch {
    server = false;
  }
  return { proof: createHash('sha256').update(clientKey).digest('base64') === stored, server };
}

it('stores a SCRAM-SHA-256 verifier that the password, and only the password, signs in against', async () => {
  const password = randomBytes(32).toString('base64url');
  const verifier = scramVerifier(password);
  expect(verifier).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  expect(await signIn(verifier, password)).toEqual({ proof: true, server: true });
  expect(await signIn(verifier, `${password}x`)).toEqual({ proof: false, server: false });
  // A fresh salt each time.
  expect(scramVerifier(password)).not.toBe(verifier);
});
