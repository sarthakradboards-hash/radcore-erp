// Next runs register() once as the server starts, in the Node server and (unused here) the Edge runtime.
// Turbopack warns at build that kit-guard's process.exit has no Edge equivalent; the guard below keeps it off Edge.
import { refuseKitPageWhenDeployed } from './kit-guard.ts';

export function register() {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') refuseKitPageWhenDeployed();
}
