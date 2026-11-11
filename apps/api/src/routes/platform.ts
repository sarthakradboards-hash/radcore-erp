// lib-platform's routes (ADR-001 §6): your own session and sessions, the admin's sessions (RAD-34), asking for a
// password reset (RAD-32), which only queues its email, and the security events (RAD-31). Sign-in and the password
// routes need Argon2id and the lockout store, so they're built at start (createAuth's routes).
import {
  defineRoute, endAnySession, endCurrentSession, endOwnSession, endPersonSessions, getMyself, listAllSessions,
  listOwnSessions, listSecurityEventsPage, requestPasswordReset,
} from '@radcore/lib-platform';
import * as contract from '@radcore/lib-platform/contract';

export default [
  defineRoute(contract.signOut, endCurrentSession),
  defineRoute(contract.getMe, getMyself),
  defineRoute(contract.listMySessions, listOwnSessions),
  defineRoute(contract.endMySession, endOwnSession),
  defineRoute(contract.listSessions, listAllSessions),
  defineRoute(contract.endSession, endAnySession),
  defineRoute(contract.endUserSessions, endPersonSessions),
  defineRoute(contract.requestPasswordReset, requestPasswordReset),
  defineRoute(contract.listSecurityEvents, listSecurityEventsPage),
];
