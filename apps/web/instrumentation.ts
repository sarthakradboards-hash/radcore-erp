// Next runs register() once as the server starts, in the Node server and (unused here) the Edge runtime.
// Turbopack warns at build that kit-guard's and web-settings' process.exit has no Edge equivalent; the guard below
// keeps both off Edge.
import { refuseKitPageWhenDeployed } from './kit-guard.ts';
import { refuseBadWebSettings } from './web-settings.ts';

export function register() {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  refuseKitPageWhenDeployed();
  refuseBadWebSettings();
}
