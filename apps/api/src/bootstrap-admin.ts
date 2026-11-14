// `bootstrap-admin` (ADR-004 §3, RAD-32): run once by the deploy job through SSM, as the runtime login. It invites
// SEED_ADMIN_EMAIL to be the first admin; `--reissue` sends a fresh invite until someone has accepted. It prints one
// line, naming only a masked address: never a link, a token or a password.
import { createLog } from '@radcore/lib-platform';
import { runBootstrapAdmin } from '@radcore/lib-platform/runtime';

const log = createLog({ level: 'info', service: 'bootstrap-admin' });
try {
  log.info(await runBootstrapAdmin(process.env, log, { reissue: process.argv.includes('--reissue') }));
} catch (err) {
  log.error('bootstrap-admin failed', err);
  process.exitCode = 1;
}
