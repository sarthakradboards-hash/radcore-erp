# ADR-003: Proven libraries over hand-written code

- Status: accepted
- Date: 2026-11-06
- Ticket: RAD-9 (M0-04). Covers RC-220.
- Decided by: N2 (Sarthak, 5 Nov 2026: proven npm libraries instead of hand-written code).
- Builds on: [ADR-001](001-layers.md) (where each library is used), [ADR-002](002-data-access.md) (Drizzle and the
  lint rules).

## Context

v1 wrote its own CSV reader, Excel writer, job loop, rate limiter store, error tracking, phone and date checks and
UI widgets. The hand-written versions covered the cases their author thought of and nothing else (Technical report
Theme 4). Examples: a CSV split that turned 9,111.00 into Rs 9 (RC-118), a sender check matched by substring
(RC-144), a date check that accepted 31 February (RC-168), and a job loop with no retry or timeout (RC-082). At the
same time v1 declared dependencies it never used, one of which pulled in ten old packages, and nothing checked the
manifests or the Node version (RC-220).

## Decision

### 1. How a need is met

Take the first option that fully works, in this order:

1. The platform: Node's standard library, PostgreSQL, the browser. Examples: `crypto.randomUUID`,
   `Intl.NumberFormat('en-IN')` for lakh and crore grouping, AES-256-GCM in `node:crypto`, `gen_random_uuid()`.
2. A library already in the approved list below.
3. A new proven library, added under §4.
4. Our own code, only for what no proven library does (§3).

### 2. The approved list

Versions are exact (no `^` or `~`). Each was released at least 14 days before 6 Nov 2026, the date of this ADR,
except where marked. All were checked on npm on 6 Nov 2026.

**Runtime and language**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| Runtime | Node.js, LTS "Lithium" | 26.13.0 (see §5) | MIT | Node 22 types, no version check (RC-220) |
| Language | typescript | 6.0.3 | Apache-2.0 | same tool. TypeScript 7 (native) waits until typescript-eslint supports it: 8.72 needs `<6.1` |
| Run TS scripts in dev | tsx | 4.23.15 | MIT | same |

**Server**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| HTTP server | express | 5.3.0 | MIT | same framework, now behind `defineRoute` |
| Security headers | helmet | 8.3.0 | MIT | same |
| Validation | zod | 4.6.7 | MIT | same |
| Money (decimal) | decimal.js | 10.6.0 | MIT | same library, now behind lib-common's money helpers |
| Dates and India time | date-fns, @date-fns/tz | 4.4.0, 1.5.0 | MIT | hand-written `istDate()` and date checks that accepted 31 Feb (RC-168) |
| Phone numbers | libphonenumber-js | 1.13.15 | MIT | hand-written phone normalising |
| Amount in words (lakh, crore) | to-words | 7.4.0 | MIT | hand-written words for the invoice total |
| ORM and migrations | drizzle-orm, drizzle-kit | 0.45.4, 0.31.11 | Apache-2.0, MIT | same (ADR-002). 1.0 is at rc.5. Move when it's stable and 14 days old, in its own ticket |
| PostgreSQL driver | pg | 8.23.1 | MIT | same. PGlite is dropped; tests run on real PostgreSQL 16 (RC-154) |
| Logging | pino, pino-http | 10.4.0, 11.0.0 | MIT | `console` plus the home-made error log and alerts (RC-158) |
| Background jobs | pg-boss | 12.38.0 | MIT | the in-process job loop with no queue, retry, timeout or overlap guard (RC-082). Services queue through an outbox row in their own transaction; the worker's relay hands committed rows to pg-boss, which runs them with retries, timeouts, singleton keys and dead letters (ADR-002 §4, M1-26). |
| Password hashing | @node-rs/argon2 | 2.2.2 | MIT | bcryptjs. Argon2id per M1-14; prebuilt binaries, so no compiler toolchain |
| Second factor (TOTP) | otpauth | 9.5.2 | MIT | nothing (RC-055) |
| Rate limits in a shared store | rate-limiter-flexible (PostgreSQL store) | 11.2.3 | ISC | express-rate-limit counting in memory (RC-088, Theme 10) |
| File store | @aws-sdk/client-s3 | 3.1155.0 | Apache-2.0 | files in the database or on local disk. Works with MinIO in dev |
| CSV read and write (streams) | csv-parse, csv-stringify | 7.0.3, 6.9.0 | MIT | hand-written comma split and quadratic amount pattern (RC-118) |
| Text encoding of imports | chardet, iconv-lite | 2.2.0, 0.7.3 | MIT | UTF-8 only (RC-117) |
| Excel read and write | read-excel-file, write-excel-file | 9.3.12, 4.1.1 | MIT | hand-written `lib/xlsx.ts` writer, and no Excel import at all (RC-117) |
| PDF read (bank statements) | unpdf | 1.9.1 | MIT | same library (2.x is too new) |
| PDF write (invoice, challan, receipt) | @react-pdf/renderer | 4.9.0 | MIT | browser print only (RC-152). Runs in the worker |
| Mail (IMAP) | imapflow | 2.8.0 | MIT | same |
| Mail parsing | mailparser | 3.12.2 | MIT | same |
| Mail sender check (DKIM, DMARC) | mailauth | 8.0.4 | MIT | the hand-split `Authentication-Results` header and substring sender match (RC-144) |

**Web**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| Framework | next | **16.4.5** (security release, see §5) | MIT | same framework |
| UI library | react, react-dom | 19.3.1 | MIT | same |
| UI primitives (dialog, popover, select, tabs, menu) | radix-ui | 1.8.1 | MIT | hand-made `Modal`, `Tabs`, menus in `ui.tsx` |
| Server data and writes | @tanstack/react-query | 5.104.5 | MIT | hand-written `useGet` cache and `useSaving` |
| Tables, long lists | @tanstack/react-table, @tanstack/react-virtual | 9.3.1, 3.14.21 | MIT | hand-made `Table` |
| Forms | react-hook-form, @hookform/resolvers | 7.90.0, 6.0.0 | MIT | hand-made `Form` internals |
| Combobox (server search) | cmdk | 1.1.1 | MIT | pickers that loaded a fixed slice (RC-086). Last release March 2025: stable and small, so it's kept (§4 maintenance rule) |

**Tests**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| Unit and API tests | vitest, @vitest/coverage-v8 | 5.0.5, 5.0.5 | MIT | same runner; coverage is new |
| Component tests | @testing-library/react | 16.3.3 | MIT | none (WEB-19) |
| Outside services in tests | msw | 3.0.3 | MIT | hand-made payloads that skipped the production path (RC-143) |
| Browser journeys | @playwright/test | 1.64.1 | Apache-2.0 | none (RC-150) |
| Accessibility scan | @axe-core/playwright | 4.14.0 | MPL-2.0 (dev only, unmodified) | none |
| Mutation testing | @stryker-mutator/core, @stryker-mutator/vitest-runner | 10.0.0, 10.0.0 | Apache-2.0 | a desk-check estimate only (RC-069) |

**Tooling and checks**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| Lint | eslint | 9.39.5 | MIT | no linter. ESLint 10 waits: eslint-plugin-react, pulled in by eslint-config-next, supports `^9.7` |
| TypeScript lint | typescript-eslint | 8.72.0 | MIT | none |
| Next and React lint rules (includes `react/no-danger`) | eslint-config-next | 16.4.5 (matches next) | MIT | none |
| Drizzle lint rules | eslint-plugin-drizzle | 0.2.3 | Apache-2.0 | none. Its stable is from 2023, but it is published from the Drizzle monorepo alongside 1.0 (§4 maintenance rule) |
| Import boundaries | dependency-cruiser | 18.7.0 | MIT | none (ADR-001 D1 to D9) |
| Unused files, exports, dependencies | knip | 6.42.1 | ISC | none (RC-220) |

`@types/*` packages follow their runtime's major version (for example `@types/node` 26.x) and are pinned exactly by
M0-07 under the same 14-day rule.

### 3. Written by us, on purpose

Each of these is small, is specific to Indian rules or to RadCore, and has no proven library. Each needs table-driven
tests worked from the source text:

- GSTIN format and checksum, PAN format, state code from GSTIN (M1-03).
- Place of supply and the GST split, the cess, the round-off (lib-gst).
- CSV formula-injection guard on exported cells (a leading `=`, `+`, `-` or `@` is escaped; M1-29).
- Envelope encryption over `node:crypto` (M1-24).

### 4. Adding or changing a dependency

A dependency is added in the PR that first needs it. **That PR also adds its row to §2.** No row, no merge.

- **Who approves.** The architect reviews the row, the auditor checks it, and the coordinator approves by merging.
  A new runtime dependency (not dev-only) is called out in the PR description.
- **Before proposing one:** the need can't be met by the platform or a library already listed (§1). The library
  is used for more than a few lines' worth of work.
- **Licence:** MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0. MPL-2.0 is allowed for
  dev-only tools used unmodified. GPL, AGPL, LGPL, SSPL, an unknown licence or no licence is refused.
- **Maintenance:** a release in the last 12 months, or a stated reason in its row (for example, cmdk is stable and
  small). It must have no open advisory without a fix (`npm audit`). Its install scripts, if any, are named in the PR.
- **Age:** the exact version is at least 14 days old, unless it fixes a published security advisory. In that case
  the row says which one (Next 16.4.5).
- **Pinning:** exact versions in `package.json` (`save-exact=true` in `.npmrc`), with the lockfile committed.
- **Dependabot (RAD-16):** when M0-07 adds the npm entry, every ecosystem gets `cooldown: { default-days: 14 }`.
  Security updates are not held back by it. M0-07 checks that GitHub accepts the key (the Dependabot config check
  on its PR is green). A major version update gets its own ticket.

### 5. Node and the two exceptions

- **Node 26.13.0.** Node 26 became the Active LTS line ("Lithium") in late October 2026, with maintenance until
  April 2029. Node 24 is now in maintenance. The runtime follows Node's LTS line rather than the 14-day rule,
  because its releases are security-reviewed upstream and every LTS patch is taken.
  - `.nvmrc` holds `26.13.0`, and `package.json` has `"engines": { "node": ">=26.13.0 <27" }`.
  - `.npmrc` has `engine-strict=true`, so `npm ci` refuses another Node.
  - The Docker image (ADR-004) uses the same version.
  - M0-07's proof (fresh clone, `npm ci`, `npm run dev`, `npm test`) runs on 26.13.0. If a listed library fails on
    Node 26, the fallback is Node 24 LTS ("Krypton", maintained to April 2028), changed in this ADR, not worked
    around in code.
- **Next 16.4.5** (3 Nov 2026) is taken at once. It fixes the advisories published that day for Next 16.4.x
  (among them GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8). Holding it back two weeks would keep a known hole open.

## CI checks (for M0-08)

| # | Check | Fails when |
|---|---|---|
| C1 | `knip` | a dependency is declared and not used, used and not declared, or a file or export is unused |
| C2 | Node version | `node --version` in CI differs from `.nvmrc`, or `engines` is missing from a workspace |
| C3 | exact pins | any version in a `package.json` starts with `^`, `~`, `>`, `*` or is a range |
| C4 | licences | any package in `package-lock.json` (lockfile v3 records each package's `license`) has a licence outside §4's list. MPL-2.0 is allowed only for dev packages. A ~20-line script, no extra dependency. |
| C5 | advisories | `npm audit --omit=dev` reports an advisory of moderate or higher |
| C6 | list and lockfile agree | a direct dependency in any `package.json` has no row in §2, or its version differs from the row. Checked by a test that reads this file's tables, so the list can't drift from what is installed |

Each check has a violating fixture in `tools/boundary-fixtures/` (an unused dependency, a `^` range, a GPL
package, an unlisted dependency), run on every CI build like ADR-001's.

## Consequences

- Most of v1's hand-written plumbing is replaced by the list above. What stays ours is listed in §3 and gets
  table-driven tests.
- Every dependency has a written reason and an owner, and CI refuses an unused, unpinned, unlisted or wrongly
  licensed one.
- Two upgrades are waiting and named: TypeScript 7 (typescript-eslint support) and ESLint 10 (eslint-plugin-react
  support), and Drizzle 1.0 when stable.

## Alternatives considered

- **exceljs** for Excel: its last release was October 2023. read-excel-file and write-excel-file are maintained.
- **SheetJS (`xlsx`) from npm:** the npm copy is out of date. Newer builds are published only on its own site.
- **papaparse** for CSV: it detects delimiters well, but has no streaming writer. csv-parse and csv-stringify come
  from one project and stream both ways.
- **argon2** (node-argon2): it builds with node-gyp; @node-rs/argon2 ships prebuilt binaries.
- **otplib:** larger. otpauth covers RFC 4226 and 6238 in one small package.
- **PGlite for tests:** it's a different engine with one connection, which hid locking bugs in v1 (RC-154).
- **Tailwind or shadcn tooling:** not adopted (Design notes A3). Radix primitives sit under our own components.
