// Runs in the browser before any of the app's own modules (Next loads it before the router and every route).
// zod builds a fast parser with new Function() unless told not to, and our CSP has no 'unsafe-eval' (RAD-56), so
// every page load raised a CSP violation. The setting is read when a schema is built, hence here, before lib-common.
import { z } from 'zod';

z.config({ jitless: true });
