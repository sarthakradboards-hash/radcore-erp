// Stored secrets (bank-statement passwords, integration tokens) under envelope encryption (RAD-42, RC-213; ADR-003).
// Each value gets its own data key from the AWS Encryption SDK, wrapped by the KMS key in staging and production
// (multi-Region aware, ADR-004 §4) or by SECRETS_LOCAL_KEY elsewhere. The encryption context names the table,
// column and row, and decryption checks it, so a ciphertext copied into another row won't decrypt.
import { createHash } from 'node:crypto';
import {
  buildAwsKmsMrkAwareStrictMultiKeyringNode, buildClient, CommitmentPolicy, RawAesKeyringNode,
  RawAesWrappingSuiteIdentifier, type KeyringNode,
} from '@aws-crypto/client-node';
import { MULTI_REGION_KEY_ARN, type Config } from './config.ts';

/** Where a secret lives. It is bound into the ciphertext. */
export type SecretPlace = { table: string; column: string; rowId: string };
export type Secrets = {
  /** Encrypt `value` for one place. The result is base64, to store as text. */
  encrypt(value: string, place: SecretPlace): Promise<string>;
  /** Decrypt, refusing a ciphertext made for any other place. */
  decrypt(ciphertext: string, place: SecretPlace): Promise<string>;
  /** Decrypt and encrypt again under the current key: a new data key, wrapped by today's key (rotation). */
  reencrypt(ciphertext: string, place: SecretPlace): Promise<string>;
  /** The key new values are wrapped by, stored next to each ciphertext (RAD-65): the KMS key ARN, or `local:<ring>`. */
  readonly keyId: string;
};

// The SDK signs with an ECDSA key it puts in the context itself; nothing else may be there but ours.
const SDK_SIGNING_FIELD = 'aws-crypto-public-key';
// The local key can't rotate: data keys still change per value, but replacing SECRETS_LOCAL_KEY makes everything it
// wrapped unreadable. It's for development, CI and the sample-data test copy only (ADR-004 §5); KMS rotates in production.
const LOCAL_RING_NAME = 'secrets-local-v1';
// One keyring wraps each data key, so a message with more wrapped keys is not ours: refuse it before any KMS call.
const { encrypt, decrypt } = buildClient({ commitmentPolicy: CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT,
  maxEncryptedDataKeys: 1 });

export class SecretPlaceMismatch extends Error {
  constructor() {
    super('This secret was encrypted for another table, column or row');
    this.name = 'SecretPlaceMismatch';
  }
}

function keyring(keys: Config['secrets']): KeyringNode {
  if (keys.kmsKeyId !== null && keys.localKey === null) {
    // config.ts refuses this at start; checked again because the wrong form encrypts fine and never decrypts.
    if (!MULTI_REGION_KEY_ARN.test(keys.kmsKeyId)) throw new Error('SECRETS_KMS_KEY_ID must be a multi-Region KMS key ARN');
    return buildAwsKmsMrkAwareStrictMultiKeyringNode({ generatorKeyId: keys.kmsKeyId });
  }
  if (keys.localKey !== null && keys.kmsKeyId === null) {
    const raw = Buffer.from(keys.localKey, 'base64');
    // config.ts refuses a shorter key at start; checked again here because a short key is the one fatal mistake (RC-213).
    if (raw.length < 32) throw new Error('SECRETS_LOCAL_KEY must be at least 32 random bytes');
    // AES-256 needs exactly 32 bytes; hashing uses all of a longer key's randomness.
    const unencryptedMasterKey = new Uint8Array(createHash('sha256').update(raw).digest());
    return new RawAesKeyringNode({ keyName: LOCAL_RING_NAME, keyNamespace: 'radcore', unencryptedMasterKey,
      wrappingSuite: RawAesWrappingSuiteIdentifier.AES256_GCM_IV12_TAG16_NO_PADDING });
  }
  throw new Error('exactly one of SECRETS_KMS_KEY_ID and SECRETS_LOCAL_KEY must be set');
}

const contextOf = (place: SecretPlace): Record<string, string> =>
  ({ table: place.table, column: place.column, rowId: place.rowId });

export function createSecrets(keys: Config['secrets']): Secrets {
  const ring = keyring(keys);
  const secrets: Secrets = {
    keyId: keys.kmsKeyId ?? `local:${LOCAL_RING_NAME}`,
    async encrypt(value, place) {
      const { result } = await encrypt(ring, value, { encryptionContext: contextOf(place) });
      return result.toString('base64');
    },
    async decrypt(ciphertext, place) {
      const { plaintext, messageHeader } = await decrypt(ring, Buffer.from(ciphertext, 'base64'));
      const want = contextOf(place);
      const got = { ...messageHeader.encryptionContext };
      delete got[SDK_SIGNING_FIELD];
      const same = Object.keys(got).length === Object.keys(want).length
        && Object.entries(want).every(([k, v]) => got[k] === v);
      if (!same) throw new SecretPlaceMismatch();
      return plaintext.toString('utf8');
    },
    async reencrypt(ciphertext, place) {
      return secrets.encrypt(await secrets.decrypt(ciphertext, place), place);
    },
  };
  return secrets;
}

/** Outside tokens that expire before `horizon`, soonest first: what the expiry watch alerts on (RC-213). */
export function expiringBefore<T extends { expiresAt: string | null }>(tokens: T[], horizon: string): T[] {
  const limit = Date.parse(horizon);
  if (Number.isNaN(limit)) throw new Error(`expiringBefore needs a valid horizon, got ${JSON.stringify(horizon)}`);
  // Fails closed: an expiry that can't be read counts as already past, so it is reported first, never skipped.
  const at = (t: T): number => {
    const ms = Date.parse(t.expiresAt ?? '');
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };
  return tokens.filter((t) => t.expiresAt !== null && at(t) < limit).sort((a, b) => at(a) - at(b));
}
