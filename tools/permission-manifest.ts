// The permission manifest (RAD-37, M1-19, RC-153): what each route and job must check, written out by hand here and
// never read from the code. v1's sweep checked the code against itself, so deleting a check made the sweep skip the
// route. tools/permission-manifest.test.ts compares this table with what the api and worker actually mount, so a route
// that loses or changes its check, or appears without a line here, fails CI, and so does a line here for a route
// that's gone. Change a line only with the route's own change, in the same review.

/** Each route, as "METHOD /path": its permission key; `public` for a route anyone may call (its own rate limit and,
 * for sign-in, its own checks); or `link <action>` for a public link's one action (RAD-41). A module's export start
 * route (defineExport) gets its line here like any other, with its own key: the export job checks that same key. */
export const ROUTE_CHECKS: Readonly<Record<string, string>> = {
  // Sign-in, the second factor and passwords (RAD-32, RAD-33, RAD-34): public, with their own checks.
  'POST /sign-in': 'public',
  'POST /sign-in/second-factor': 'public',
  'POST /sign-in/second-factor/enrolment': 'public',
  'POST /sign-in/second-factor/enrolment/confirm': 'public',
  'POST /password-reset/request': 'public',
  'POST /password-reset': 'public',
  'POST /invites/accept': 'public',
  // The browser's error report (RC-158): public, so a signed-out page reports too; its own per-address limit.
  'POST /client-errors': 'public',
  // Your own account (RAD-32, RAD-33, RAD-34, RAD-47): session:read, which every role holds.
  'POST /sign-out': 'session:read',
  'GET /me': 'session:read',
  'POST /me/password': 'session:read',
  'POST /me/second-factor/recovery-codes': 'session:read',
  'GET /me/sessions': 'session:read',
  'DELETE /me/sessions/:id': 'session:read',
  'GET /exports/:id': 'session:read',
  'POST /exports/:id/download': 'session:read',
  // Admin: people and sessions (RAD-33, RAD-34, RAD-36).
  'GET /admin/sessions': 'users:read',
  'DELETE /admin/sessions/:id': 'users:write',
  'POST /admin/users/:id/sessions/end': 'users:write',
  'POST /admin/users/:id/second-factor/remove': 'users:write',
  'PUT /admin/users/:id/role': 'users:write',
  'GET /admin/users': 'users:read',
  'POST /admin/users': 'users:write',
  'POST /admin/users/:id/invite': 'users:write',
  'POST /admin/users/:id/deactivate': 'users:write',
  'POST /admin/users/:id/reactivate': 'users:write',
  // Admin: roles and the permission matrix (RAD-36).
  'GET /admin/roles': 'roles:read',
  'GET /admin/permissions': 'roles:read',
  'PUT /admin/roles/:key/permissions': 'roles:write',
  // Admin: custom roles and the built-in templates (RAD-83).
  'POST /admin/roles': 'roles:write',
  'PATCH /admin/roles/:key': 'roles:write',
  'POST /admin/roles/:key/delete': 'roles:write',
  'POST /admin/roles/:key/reset': 'roles:write',
  // Admin: the audit trail and security events (RAD-30, RAD-31).
  'GET /admin/audit': 'audit:read',
  'GET /admin/audit/tables': 'audit:read',
  'GET /admin/security-events': 'audit:read',
  // Files, by kind (RAD-43): each kind its own pair of keys.
  'POST /files/photo': 'photo_files:write',
  'POST /files/photo/:id/confirm': 'photo_files:write',
  'POST /files/photo/:id/download': 'photo_files:read',
  'POST /files/resume': 'resume_files:write',
  'POST /files/resume/:id/confirm': 'resume_files:write',
  'POST /files/resume/:id/download': 'resume_files:read',
  'POST /files/statement': 'statement_files:write',
  'POST /files/statement/:id/confirm': 'statement_files:write',
  'POST /files/statement/:id/download': 'statement_files:read',
  'POST /files/import': 'import_files:write',
  'POST /files/import/:id/confirm': 'import_files:write',
  'POST /files/import/:id/download': 'import_files:read',
};

/** Each job: `system <name> [<keys>]` for a schedule or webhook, or `user <key>` for one queued by a person, checked
 * again when it runs; `user <by input>` where the key comes from the job's input. The export job is that one: it
 * checks each export kind's own key, the one its start route's line above names (no module declares one yet). */
export const JOB_PRINCIPALS: Readonly<Record<string, string>> = {
  'platform.saved-once-cleanup': 'system saved-once-cleanup []',
  'platform.outbox-cleanup': 'system outbox-cleanup []',
  'platform.secrets-expiry': 'system secrets-expiry []',
  'platform.webhook-stuck': 'system webhook-stuck []',
  'platform.file-check': 'system file-check []',
  'platform.password-reset-email': 'system password-reset []',
  'platform.invite-email': 'system invites []',
  'platform.export': 'user <by input>',
};

/** Which libraries each route's and job's own code reaches (RAD-84, M1-19, RC-153), keyed as above: the library of the
 * service its route or job file names, or of what builds it at start (createAuth, the email jobs), and every library
 * that code imports, through every file, lib-common aside (it holds no services). tools/permission-reach.test.ts works
 * the reach out from the code, never from here, so a route or job that starts reaching another module's services, or
 * stops, fails CI until its line here changes, in the same review. */
const PLATFORM = ['lib-platform'];
export const ROUTE_REACH: Readonly<Record<string, readonly string[]>> = {
  // Routes, in ROUTE_CHECKS' order: lib-platform's own, for now.
  'POST /sign-in': PLATFORM,
  'POST /sign-in/second-factor': PLATFORM,
  'POST /sign-in/second-factor/enrolment': PLATFORM,
  'POST /sign-in/second-factor/enrolment/confirm': PLATFORM,
  'POST /password-reset/request': PLATFORM,
  'POST /password-reset': PLATFORM,
  'POST /invites/accept': PLATFORM,
  'POST /client-errors': PLATFORM,
  'POST /sign-out': PLATFORM,
  'GET /me': PLATFORM,
  'POST /me/password': PLATFORM,
  'POST /me/second-factor/recovery-codes': PLATFORM,
  'GET /me/sessions': PLATFORM,
  'DELETE /me/sessions/:id': PLATFORM,
  'GET /exports/:id': PLATFORM,
  'POST /exports/:id/download': PLATFORM,
  'GET /admin/users': PLATFORM,
  'GET /admin/sessions': PLATFORM,
  'DELETE /admin/sessions/:id': PLATFORM,
  'POST /admin/users/:id/sessions/end': PLATFORM,
  'POST /admin/users/:id/second-factor/remove': PLATFORM,
  'PUT /admin/users/:id/role': PLATFORM,
  'POST /admin/users': PLATFORM,
  'POST /admin/users/:id/invite': PLATFORM,
  'POST /admin/users/:id/deactivate': PLATFORM,
  'POST /admin/users/:id/reactivate': PLATFORM,
  'GET /admin/roles': PLATFORM,
  'GET /admin/permissions': PLATFORM,
  'PUT /admin/roles/:key/permissions': PLATFORM,
  'POST /admin/roles': PLATFORM,
  'PATCH /admin/roles/:key': PLATFORM,
  'POST /admin/roles/:key/delete': PLATFORM,
  'POST /admin/roles/:key/reset': PLATFORM,
  'GET /admin/audit': PLATFORM,
  'GET /admin/audit/tables': PLATFORM,
  'GET /admin/security-events': PLATFORM,
  'POST /files/photo': PLATFORM,
  'POST /files/photo/:id/confirm': PLATFORM,
  'POST /files/photo/:id/download': PLATFORM,
  'POST /files/resume': PLATFORM,
  'POST /files/resume/:id/confirm': PLATFORM,
  'POST /files/resume/:id/download': PLATFORM,
  'POST /files/statement': PLATFORM,
  'POST /files/statement/:id/confirm': PLATFORM,
  'POST /files/statement/:id/download': PLATFORM,
  'POST /files/import': PLATFORM,
  'POST /files/import/:id/confirm': PLATFORM,
  'POST /files/import/:id/download': PLATFORM,
  // Jobs, in JOB_PRINCIPALS' order.
  'platform.saved-once-cleanup': PLATFORM,
  'platform.outbox-cleanup': PLATFORM,
  'platform.secrets-expiry': PLATFORM,
  'platform.webhook-stuck': PLATFORM,
  'platform.file-check': PLATFORM,
  'platform.password-reset-email': PLATFORM,
  'platform.invite-email': PLATFORM,
  'platform.export': PLATFORM,
};
