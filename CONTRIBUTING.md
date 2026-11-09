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
npm run db:up      # PostgreSQL 16 and SeaweedFS (S3), on 127.0.0.1 only (needs Docker)
npm run db:migrate # the migrations, as the owner login (MIGRATION_DATABASE_URL); run after db:up and each pull
```

`npm run dev` and `npm run db:up` first write `.env` with new random credentials if it doesn't exist. `.env` is
git-ignored; never commit it. Each lint rule has a violating fixture in `tools/boundary-fixtures/`, and
`npm test` fails if any fixture stops failing.

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
TEST_DATABASE_ADMIN_URL="$(grep ^DATABASE_URL= .env | cut -d= -f2-)" npm test
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
