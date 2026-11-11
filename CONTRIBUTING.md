# Contributing to RadCore

## The flow

1. No work without a Linear ticket (team Radboards-ERP, project "RadCore v2").
2. Branch from `dev`. Name the branch `<ticket-id>-<slug>`, lowercase: `rad-6-repository-guardrails`.
   Do not use Linear's suggested name: it starts with a user prefix (`jainsarthak0205/...`). The
   `branch-name` check fails any other name.
3. Open a PR into `dev` and fill in the template.
4. A PR is merged only after auditor PASS, e2e-playwright PASS (user-facing tickets only) and the
   coordinator's check. Only the coordinator merges.
5. **A PR merges only with `ci` green, and with `e2e` green whenever the e2e workflow ran on it.** The `ci`
   workflow's last job, named `ci`, is green only when every other job is. GitHub can't enforce either on this plan
   (no branch protection, N5), so the coordinator checks both on the PR's final head before every merge, and never
   merges one that is red, cancelled or missing.

**Never push directly to `dev` or `main`.** GitHub does not refuse such a push here: the repository
is on the Free plan with no branch protection (Sarthak's decision, 5 Nov 2026). The rule holds only
because everyone keeps it. Every change reaches `dev` through a reviewed PR that the coordinator merges.

**Dependabot PRs** come from `dependabot/...` branches. They are exempt from the `<ticket-id>-<slug>`
name only when Dependabot opened the PR: a person's PR from a `dependabot/...` branch fails the check. They belong to the standing ticket
[RAD-16](https://linear.app/radboards-erp/issue/RAD-16), and each one links to it. The auditor
reviews them, and so does e2e-playwright when they touch `apps/web` or a UI library. The coordinator
merges them. A major version update gets its own ticket.

## Local setup

Use Node 26.13.0 (`.nvmrc`). `npm ci` refuses any other version (`engine-strict`) and runs no install scripts
(`ignore-scripts`, ADR-003 §6).

```bash
npm ci
npm run dev        # API on 127.0.0.1:3001, web on 127.0.0.1:3000, worker
npm test
npm run lint       # ESLint (ADR-001 E rules, ADR-002 L rules) and dependency-cruiser (D rules, L7)
npm run typecheck
npm run deps:check # ADR-003 C2 to C9: Node version, pins, licences, the approved list, lockfile, age
npm run knip       # unused files, exports and dependencies (C1)
npm run db:up      # PostgreSQL 16 and SeaweedFS (S3), on 127.0.0.1 only (needs Docker), then the three logins
npm run db:migrate # the migrations, as the owner login (MIGRATION_DATABASE_URL); run after db:up and each pull
```

`npm run dev` and `npm run db:up` first write `.env` with new random credentials if it doesn't exist. `.env` is
git-ignored; never commit it.

**Open the app at http://127.0.0.1:3000**, not `localhost:3000`. That's `.env`'s `PUBLIC_ORIGIN`, and the api
refuses any write whose `Origin` differs (403, RAD-39). In development and CI the browser's `/api/…` calls go
through the web app to the api at `API_INTERNAL_URL` (a rewrite in `apps/web/next.config.ts`); deployed, Caddy
routes `/api` instead. The web app reads the same root `.env` as the api and worker (`apps/web/scripts/dev.ts`). Each lint rule has a violating fixture in `tools/boundary-fixtures/`, and
`npm test` fails if any fixture stops failing.

**The database logins** (RAD-24, ADR-005 §7c). The api and worker run as `radcore_app` (`DATABASE_URL`), the
migrations as `radcore_owner` (`MIGRATION_DATABASE_URL`), and support queries as `radcore_read`
(`DATABASE_READ_URL`). The compose superuser (`DATABASE_ADMIN_URL`) only makes the logins (`npm run db:logins`).
- An `.env` from before RAD-24 has none of this, and its database was migrated as the superuser. Run
  `docker compose -f compose.dev.yml down -v`, delete `.env`, then `npm run db:up` and `npm run db:migrate`.
- An append-only table's migration (ADR-005 §7) adds
  `REVOKE UPDATE, DELETE, TRUNCATE ON radcore.<table> FROM radcore_app` (and `INSERT` for `audit_log` and
  `access_log`). A view's migration adds `REVOKE INSERT, UPDATE, DELETE ON radcore.<view> FROM radcore_app`,
  because a simple view writes as its owner. Every partition, from a migration or the partition top-up, gets
  `REVOKE ALL ON radcore.<partition> FROM radcore_app, radcore_read`: rows go through the parent.
  `tools/logins.test.ts` fails on any it misses.
- The database tests get `TEST_DATABASE_URL` as the runtime login. A test that makes its own tables uses
  `TEST_DATABASE_OWNER_URL`, and one that switches between logins uses `TEST_DATABASE_SUPERUSER_URL`.

## Migrations

- Change the schema in `packages/db`, then run `npx drizzle-kit generate --name <what>`. For hand-written SQL,
  run `npx drizzle-kit generate --custom --name <what>` and fill in the empty file. Commit the `.sql` file and
  `meta/`.
- Never edit a migration that has merged. Add a new one.
- **After merging dev, if dev gained a migration your branch doesn't have, regenerate yours.** Delete your `.sql`
  file and its journal entry and snapshot, then run `generate` again, so your migration comes after dev's.
  - drizzle applies a migration only if its journal `when` is later than the last one applied, so an older `when`
    would be skipped silently on every database that is already migrated.
  - `tools/migrate.test.ts` fails when the journal is out of order. In CI it also compares with the base commit:
    each new migration must be dated after the newest one there, and merged migrations must be unchanged.

## Tests

**Every register proof lives in the normal suite** (RC-019). A test that proves an RC item is fixed sits with the
other tests and runs on every CI build. None is kept aside, skipped or marked to-do to keep CI green. A proof that
fails means the fix isn't done: fix the code, not the test.

CI (`.github/workflows/ci.yml`) runs, on every PR and every push to `dev` and `main`:

- **dependencies:** ADR-003's C1 to C10 (`npm run deps:check`, `npm run knip`, `npm audit signatures`). Never
  re-run a C9 (package age) failure to clear it: age is measured when the job runs, so a re-run days later passes
  without anything having been checked. Pin an older version, or name the exception in ADR-003 §5;
- **typecheck and lint;**
- **tests on PostgreSQL 16:** every test, with coverage uploaded. The suite gets one fresh database for the whole
  run, never one per test file (`tools/test-database.ts`, RC-005);
- **dev compose:** PostgreSQL and SeaweedFS on 127.0.0.1, plus the S3 smoke test.

To run the database tests locally, start compose and point the suite at it:

```bash
npm run db:up
TEST_DATABASE_ADMIN_URL="$(grep ^DATABASE_ADMIN_URL= .env | cut -d= -f2-)" npm test
```

## Commit identity

Commits must record the account that owns the repository, **sarthakradboards-hash**, not a personal
email. v1's deployments were blocked for exactly this.

Set it once per clone. It is stored in the repository's own `.git/config`, so every worktree of the
clone uses it:

```bash
git config --local user.name "Sarthak Jain"
git config --local user.email "330352763+sarthakradboards-hash@users.noreply.github.com"
```

Check before your first commit:

```bash
git config user.email
```

It must print the `users.noreply.github.com` address above.

## Never commit

The `secret-scan` check (gitleaks) catches most secrets. It can't read UTF-16 files (Windows PowerShell 5.1's
default output), archives, Git LFS objects or commit messages, and it skips lockfiles, `node_modules/`, `vendor/`,
images and binaries. Treat those as unscanned.

- Secrets: passwords, API keys, tokens, `.env` files with real values.
- The restricted security appendix (02b) or anything quoted from it.
- Real customer, employee or bank data.
