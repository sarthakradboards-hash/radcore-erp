// Every route the api mounts (ADR-001 §6): each module's route file, then the sign-in, second-factor and password
// routes built at start (createAuth). main.ts mounts exactly this list, and the permission manifest test (RAD-37)
// checks it against its own table.
import type { Route } from '@radcore/lib-platform';
import type { Auth } from '@radcore/lib-platform/runtime';
import fileRoutes from './routes/files.ts';
import platform from './routes/platform.ts';

// Each module's route file (apps/api/src/routes/<module>.ts) default-exports its defineRoute list; spread them in here.
export const apiRoutes = (auth: Pick<Auth, 'routes'>): readonly Route[] => [...fileRoutes, ...platform, ...auth.routes];
