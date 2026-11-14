// Every route the api mounts (ADR-001 §6): each module's route file, then the sign-in, second-factor and password
// routes built at start (createAuth), and the browser's error report (createClientErrors). main.ts mounts exactly this list, and the permission manifest test (RAD-37)
// checks it against its own table.
import type { createClientErrors, Route } from '@radcore/lib-platform';
import type { Auth } from '@radcore/lib-platform/runtime';
import accounts from './routes/accounts.ts';
import hr from './routes/hr.ts';
import fileRoutes from './routes/files.ts';
import platform from './routes/platform.ts';

// Each module's route file (apps/api/src/routes/<module>.ts) default-exports its defineRoute list; spread them in here.
export const apiRoutes = (auth: Pick<Auth, 'routes'>, clientErrors: ReturnType<typeof createClientErrors>): readonly Route[] =>
  [...fileRoutes, ...platform, ...accounts, ...hr, ...auth.routes, ...clientErrors.routes];
