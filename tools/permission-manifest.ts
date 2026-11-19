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
  // Items, their categories and units of measure (RAD-89).
  'GET /units-of-measure': 'items:read',
  'GET /item-categories': 'items:read',
  'POST /item-categories': 'items:write',
  'PATCH /item-categories/:id': 'items:write',
  // The books check (RAD-95): a read of the books, so journal:read.
  'GET /books/check': 'journal:read',
  'GET /items': 'items:read',
  'GET /items/:id': 'items:read',
  'POST /items': 'items:write',
  'PATCH /items/:id': 'items:write',
  'POST /items/:id/pictures': 'items:write',
  'DELETE /items/:id/pictures/:fileId': 'items:write',
  // The company profile (RAD-88): one company, set by whoever holds company:write.
  'GET /admin/company': 'company:read',
  'PUT /admin/company': 'company:write',
  // GST rates by date (RAD-91).
  'GET /gst/rates': 'gst:read',
  'GET /gst/rates/in-force': 'gst:read',
  'PUT /gst/rates': 'gst:write',
  // Parties (RAD-90): credit terms only with parties:manage.
  'GET /parties': 'parties:read',
  'GET /parties/:id': 'parties:read',
  'POST /parties': 'parties:write',
  'PATCH /parties/:id': 'parties:write',
  'PUT /parties/:id/credit': 'parties:manage',
  // The chart of accounts and the journal (RAD-86): posting and reversing each have their own key.
  'GET /accounts': 'journal:read',
  'PATCH /accounts/:id': 'accounts:write',
  'GET /journal': 'journal:read',
  'GET /journal/:id': 'journal:read',
  'POST /journal': 'journal:post',
  'POST /journal/:id/reverse': 'journal:reverse',
  // Price lists, their approval and discount limits (RAD-98).
  'GET /price-lists': 'prices:read',
  'GET /price-lists/:id': 'prices:read',
  'POST /price-lists': 'prices:write',
  'PATCH /price-lists/:id': 'prices:write',
  'POST /price-lists/:id/draft': 'prices:write',
  'GET /price-lists/versions/:id': 'prices:read',
  'GET /price-lists/versions/:id/rates': 'prices:read',
  'GET /price-lists/versions/:id/changes': 'prices:read',
  'PATCH /price-lists/versions/:id': 'prices:write',
  'PUT /price-lists/versions/:id/rates': 'prices:write',
  'POST /price-lists/versions/:id/approval': 'prices:write',
  'GET /approvals/price-list': 'prices:approve',
  'GET /approvals/price-list/:id': 'prices:approve',
  'POST /approvals/price-list/:id/decision': 'prices:approve',
  'GET /price-lists/:id/price': 'prices:read',
  'GET /sales/discount-limits': 'prices:read',
  'PUT /sales/discount-limits': 'prices:approve',
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
  // Item pictures (RAD-89): uploaded with the items key; no download route, since they're viewed inline.
  'POST /files/item-picture': 'items:write',
  'POST /files/item-picture/:id/confirm': 'items:write',
  // Stock (RAD-92): locations, and their kinds' labels.
  'GET /stock/location-kinds': 'locations:read',
  'PUT /stock/location-kinds/:kind': 'locations:write',
  'GET /stock/locations': 'locations:read',
  'POST /stock/locations': 'locations:write',
  'PATCH /stock/locations/:id': 'locations:write',
  // The masters workbook's start route (RAD-92): each sheet's own read key is checked again when the job runs.
  'POST /platform/masters/exports': 'masters:export',
  // HR (RAD-92): the employee master.
  'GET /hr/employees': 'employees:read',
  'POST /hr/employees': 'employees:write',
  'PATCH /hr/employees/:id': 'employees:write',
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
const STOCK = ['lib-platform', 'lib-stock'];
const HR = ['lib-hr', 'lib-platform'];
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
  // lib-stock's services, which run under lib-platform's.
  'GET /units-of-measure': STOCK,
  'GET /item-categories': STOCK,
  'POST /item-categories': STOCK,
  'PATCH /item-categories/:id': STOCK,
  // The books check reads lib-accounts' side through its exports.
  'GET /books/check': ['lib-accounts', 'lib-platform', 'lib-stock'],
  'GET /items': STOCK,
  'GET /items/:id': STOCK,
  'POST /items': STOCK,
  'PATCH /items/:id': STOCK,
  'POST /items/:id/pictures': STOCK,
  'DELETE /items/:id/pictures/:fileId': STOCK,
  // lib-accounts' services, which run under lib-platform's.
  'GET /admin/company': ['lib-accounts', 'lib-platform'],
  'PUT /admin/company': ['lib-accounts', 'lib-platform'],
  'GET /gst/rates': ['lib-gst', 'lib-platform'],
  'GET /gst/rates/in-force': ['lib-gst', 'lib-platform'],
  'PUT /gst/rates': ['lib-gst', 'lib-platform'],
  'GET /parties': ['lib-accounts', 'lib-platform'],
  'GET /parties/:id': ['lib-accounts', 'lib-platform'],
  'POST /parties': ['lib-accounts', 'lib-platform'],
  'PATCH /parties/:id': ['lib-accounts', 'lib-platform'],
  'PUT /parties/:id/credit': ['lib-accounts', 'lib-platform'],
  'GET /accounts': ['lib-accounts', 'lib-platform'],
  'PATCH /accounts/:id': ['lib-accounts', 'lib-platform'],
  'GET /journal': ['lib-accounts', 'lib-platform'],
  'GET /journal/:id': ['lib-accounts', 'lib-platform'],
  'POST /journal': ['lib-accounts', 'lib-platform'],
  'POST /journal/:id/reverse': ['lib-accounts', 'lib-platform'],
  'GET /price-lists': ['lib-platform', 'lib-sales'],
  'GET /price-lists/:id': ['lib-platform', 'lib-sales'],
  'POST /price-lists': ['lib-platform', 'lib-sales'],
  'PATCH /price-lists/:id': ['lib-platform', 'lib-sales'],
  'POST /price-lists/:id/draft': ['lib-platform', 'lib-sales'],
  'GET /price-lists/versions/:id': ['lib-platform', 'lib-sales'],
  // A version's rates read items through lib-stock's entry, which holds the stock engine and so reaches lib-accounts.
  'GET /price-lists/versions/:id/rates': ['lib-accounts', 'lib-platform', 'lib-sales', 'lib-stock'],
  'GET /price-lists/versions/:id/changes': ['lib-accounts', 'lib-platform', 'lib-sales', 'lib-stock'],
  'PATCH /price-lists/versions/:id': ['lib-platform', 'lib-sales'],
  'PUT /price-lists/versions/:id/rates': ['lib-platform', 'lib-sales'],
  'POST /price-lists/versions/:id/approval': ['lib-platform', 'lib-sales'],
  'GET /approvals/price-list': ['lib-platform', 'lib-sales'],
  'GET /approvals/price-list/:id': ['lib-platform', 'lib-sales'],
  'POST /approvals/price-list/:id/decision': ['lib-platform', 'lib-sales'],
  'GET /price-lists/:id/price': ['lib-platform', 'lib-sales'],
  'GET /sales/discount-limits': ['lib-platform', 'lib-sales'],
  'PUT /sales/discount-limits': ['lib-platform', 'lib-sales'],
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
  'POST /files/item-picture': PLATFORM,
  'POST /files/item-picture/:id/confirm': PLATFORM,
  // Stock's routes reach lib-stock and, through it, lib-platform.
  'GET /stock/location-kinds': STOCK,
  'PUT /stock/location-kinds/:kind': STOCK,
  'GET /stock/locations': STOCK,
  'POST /stock/locations': STOCK,
  'PATCH /stock/locations/:id': STOCK,
  // The workbook's start route takes only its contract (the architect on RAD-92): lib-platform's own.
  'POST /platform/masters/exports': PLATFORM,
  // HR's routes reach lib-hr and, through it, lib-platform.
  'GET /hr/employees': HR,
  'POST /hr/employees': HR,
  'PATCH /hr/employees/:id': HR,
  // Jobs, in JOB_PRINCIPALS' order.
  'platform.saved-once-cleanup': PLATFORM,
  'platform.outbox-cleanup': PLATFORM,
  'platform.secrets-expiry': PLATFORM,
  'platform.webhook-stuck': PLATFORM,
  'platform.file-check': PLATFORM,
  'platform.password-reset-email': PLATFORM,
  'platform.invite-email': PLATFORM,
  // The export job runs every export, the masters workbook's sheets from lib-stock and lib-hr among them (RAD-92).
  // lib-stock's entry holds its stock engine too, which posts revaluations through lib-accounts (RAD-93).
  'platform.export': ['lib-accounts', 'lib-hr', 'lib-platform', 'lib-stock'],
};
