// lib-platform's routes (ADR-001 §6): your own session and sessions, and the admin's sessions (RAD-34). Sign-in and
// the password routes need Argon2id and the lockout store, so they're built at start (createAuth's routes).
import {
  defineRoute, endAnySession, endCurrentSession, endOwnSession, endPersonSessions, getMyself, listAllSessions,
  listOwnSessions,
} from '@radcore/lib-platform';
import { endMySession, endSession, endUserSessions, getMe, listMySessions, listSessions, signOut } from '@radcore/lib-platform/contract';

export default [
  defineRoute(signOut, endCurrentSession),
  defineRoute(getMe, getMyself),
  defineRoute(listMySessions, listOwnSessions),
  defineRoute(endMySession, endOwnSession),
  defineRoute(listSessions, listAllSessions),
  defineRoute(endSession, endAnySession),
  defineRoute(endUserSessions, endPersonSessions),
];
