// RAD-32 (M1-14, RC-090, ADR-003): passwords are Argon2id at the production cost, in every environment, CI included.
import { hash } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { createPasswords, PASSWORD_HASH } from './passwords.ts';

const PRODUCTION = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/;

describe('passwords', () => {
  // The proof runs as the tests run (APP_ENV=ci in CI): there is no cheaper setting for any environment.
  it('hashes with Argon2id at the production cost', async () => {
    const passwords = await createPasswords();
    expect(PASSWORD_HASH).toEqual({ algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    expect(await passwords.hash('correct horse battery staple')).toMatch(PRODUCTION);
  });

  it('verifies the password it hashed, and no other', async () => {
    const passwords = await createPasswords();
    const stored = await passwords.hash('correct horse battery staple');
    expect(await passwords.verify(stored, 'correct horse battery staple')).toEqual({ ok: true, rehash: false });
    expect(await passwords.verify(stored, 'correct horse battery stapl')).toEqual({ ok: false, rehash: false });
  });

  it('asks for a rehash when a stored hash was made with other parameters', async () => {
    const passwords = await createPasswords();
    const cheap = await hash('correct horse battery staple', { algorithm: 2, memoryCost: 4096, timeCost: 1, parallelism: 1 });
    expect(await passwords.verify(cheap, 'correct horse battery staple')).toEqual({ ok: true, rehash: true });
    // A wrong password never asks for one: there's nothing to rehash it with.
    expect(await passwords.verify(cheap, 'wrong')).toEqual({ ok: false, rehash: false });
  });

  // RAD-64 item 3: an unknown address costs the same as a wrong password, because it runs the same verify.
  it('checks a missing hash against a dummy made at start, at the production cost, and refuses it', async () => {
    const passwords = await createPasswords();
    expect(passwords.dummy).toMatch(PRODUCTION);
    expect(await passwords.verify(null, 'correct horse battery staple')).toEqual({ ok: false, rehash: false });
    // A fresh dummy per process: nothing to precompute against.
    expect((await createPasswords()).dummy).not.toBe(passwords.dummy);
  });

  it('refuses a string that is not an Argon2id hash rather than throwing', async () => {
    const passwords = await createPasswords();
    expect(await passwords.verify('not a hash', 'x')).toEqual({ ok: false, rehash: false });
  });
});
