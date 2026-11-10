// The bundled common-password list (M1-14, ADR-001 §7a, ADR-003 §3): always checked, so the rule holds with no
// network. It is a data file: the entries of 15 or more characters from a public list under MIT or CC0, with its
// licence notice beside it.
// TODO(RAD-32): add data/common-passwords.txt and its licence notice, in their own commit, once Sarthak approves
// downloading the source list (SecLists, MIT). Until then a deployed api refuses to start (fails closed).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEnv } from '../config.ts';
import type { Logger } from '../log.ts';

export const COMMON_PASSWORDS_FILE = join(import.meta.dirname, '..', '..', 'data', 'common-passwords.txt');
/** A few hand-made entries for development and tests: never enough for a deployed api. */
export const COMMON_PASSWORDS_FIXTURE = join(import.meta.dirname, 'fixtures', 'common-passwords.txt');
const DEPLOYED: readonly AppEnv[] = ['staging', 'production'];

const read = (file: string): ReadonlySet<string> => new Set(readFileSync(file, 'utf8').split(/\r?\n/)
  .filter((line) => line.trim() !== '' && !line.startsWith('#')).map((line) => line.toLowerCase()));

/** Loaded once at start-up. A deployed api without the real list refuses to start. */
export function loadCommonPasswords(appEnv: AppEnv, log: Logger, file = COMMON_PASSWORDS_FILE): ReadonlySet<string> {
  if (existsSync(file)) return read(file);
  if (DEPLOYED.includes(appEnv)) {
    throw new Error(`The common-password list ${file} is missing: a ${appEnv} api can't check new passwords without it`);
  }
  log.info(`common-password list missing; using the development fixture ${COMMON_PASSWORDS_FIXTURE}`);
  return read(COMMON_PASSWORDS_FIXTURE);
}
