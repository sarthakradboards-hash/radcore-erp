# ADR-003: Proven libraries over hand-written code

- Status: accepted
- Date: 2026-11-06, revised after the auditor's review the same day
- Ticket: RAD-9 (M0-04). Covers RC-220.
- Decided by: N2 (Sarthak, 5 Nov 2026: proven npm libraries instead of hand-written code). The coordinator
  accepted the Node and Next exceptions (§5) and the outbox in front of pg-boss on 6 Nov.
- Builds on: [ADR-001](001-layers.md) (where each library is used), [ADR-002](002-data-access.md) (Drizzle, the
  outbound client and the lint rules), [ADR-004](004-runtime.md) (settings).

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

1. **The platform:** Node's standard library, PostgreSQL, the browser. For example:
   - `crypto.randomUUID` and `gen_random_uuid()` for ids;
   - `Intl.NumberFormat('en-IN')` for lakh and crore grouping;
   - `Intl` with `timeZone: 'Asia/Kolkata'` for the India date;
   - `TextDecoder` (Node's full ICU) for UTF-16 and Windows-1252 imports;
   - Node's own TypeScript type stripping for scripts;
   - `node:https` with `net.BlockList` for the outbound client.
2. A library already in the approved list below.
3. A new proven library, added under §4.
4. Our own code, only for what no proven library does (§3).

### 2. The approved list

Versions are exact (no `^` or `~`). Each was released at least 14 days before 6 Nov 2026, except the named
exceptions in §5. All were checked on npm on 6 Nov 2026, and OSV showed no advisory for any of them.

**Runtime and language**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| Runtime | Node.js, LTS "Lithium" | 26.13.0 (see §5) | MIT | Node 22 types, no version check (RC-220) |
| Language | typescript | 6.0.3 | Apache-2.0 | same tool. TypeScript 7 (native) waits until typescript-eslint supports it: 8.72 needs `<6.1` |
| Run TS scripts | none: Node runs `.ts` directly (type stripping), with `erasableSyntaxOnly: true` in `tsconfig` so every file stays strippable | | | tsx |

**Server**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| HTTP server | express | 5.3.0 | MIT | same framework, now behind `defineRoute` |
| Security headers | helmet | 8.3.0 | MIT | same |
| Validation | zod | 4.6.7 | MIT | same |
| Money (decimal) | decimal.js | 10.6.0 | MIT | same library, now behind lib-common's money helpers. Last release July 2025: a finished, widely used library with no open advisory (§4 maintenance rule) |
| Date arithmetic and strict parsing | date-fns | 4.4.0 | MIT | hand-written date checks that accepted 31 Feb (RC-168). The India date comes from `Intl` (§1) |
| Phone numbers | libphonenumber-js | 1.13.15 | MIT | hand-written phone normalising |
| Amount in words (lakh, crore) | to-words | 7.4.0 | MIT | hand-written words for the invoice total |
| ORM and migrations | drizzle-orm, drizzle-kit | 0.45.4, 0.31.11 | Apache-2.0, MIT | same (ADR-002). 1.0 is at rc.5; move when it's stable and 14 days old, in its own ticket |
| PostgreSQL driver | pg | 8.23.1 | MIT | same. PGlite is dropped; tests run on real PostgreSQL 16 (RC-154) |
| Logging | pino, pino-http | 10.4.0, 11.0.0 | MIT | `console` plus the home-made error log and alerts (RC-158). pino-http's last release was October 2025: it's a thin adapter maintained by pino's own team, with no open advisory (§4) |
| Background jobs | pg-boss | 12.38.0 | MIT | the in-process job loop with no queue, retry, timeout or overlap guard (RC-082). Fed by the outbox relay (ADR-002 §4). Built with `migrate: false`; its schema comes from a hand-written owner migration |
| Password hashing | @node-rs/argon2 | 2.2.2 | MIT | bcryptjs. Argon2id with m = 19,456 KiB, t = 2, p = 1 (the OWASP minimum), rehashed on sign-in when the parameters change. v2's users are invited fresh (M1-14), so no v1 hash is migrated and bcryptjs isn't needed. Prebuilt binaries, so no compiler toolchain |
| Second factor (TOTP) | otpauth | 9.5.2 | MIT | nothing (RC-055). Required for admin and owner (D-19). Settings: SHA-1, 6 digits, 30-second steps, a window of ±1 step, and a 20-byte random secret kept by the secrets library. The last accepted step is stored, so a code is refused if it's reused. Attempts are limited per account, and recovery codes are stored as Argon2id hashes (M1-15) |
| Envelope encryption | @aws-crypto/client-node | 5.0.2 | Apache-2.0 | the hand-written AES-GCM `secret-box`. KMS keyring in staging and production (`SECRETS_KMS_KEY_ID`); raw AES keyring from `SECRETS_LOCAL_KEY` in development and CI. Each value's encryption context names its table, column and row id, and decryption checks it, so a ciphertext copied into another row won't decrypt. Commitment policy `REQUIRE_ENCRYPT_REQUIRE_DECRYPT`; key rotation by KMS (M1-24) |
| Rate limits in a shared store | rate-limiter-flexible (PostgreSQL store) | 11.2.3 | ISC | express-rate-limit counting in memory (RC-088). Its table comes from a migration (`tableCreated: true`, since the runtime login has no DDL), and it uses its own small pool in `client.ts`. It fails **closed**: when the store can't be reached, a limited action is refused |
| File store | @aws-sdk/client-s3 | 3.1156.0 | Apache-2.0 | files in the database or on local disk. Works with SeaweedFS in development and CI (MinIO's image is no longer public; coordinator, 6 Nov) |
| Presigned URLs | @aws-sdk/s3-request-presigner, @aws-sdk/s3-presigned-post | 3.1156.0, 3.1156.0 | Apache-2.0 | none. GETs are signed by s3-request-presigner. The browser's upload is a presigned POST from s3-presigned-post, because only a POST policy can hold `content-length-range` (ADR-004 §2). Same release as client-s3 |
| CSV read and write (streams) | csv-parse, csv-stringify | 7.0.3, 6.9.0 | MIT | hand-written comma split and quadratic amount pattern (RC-118). Exports use csv-stringify's `escape_formulas` (§3) |
| Text encoding detection | chardet | 2.2.0 | MIT | UTF-8 only (RC-117). Decoding is `TextDecoder` (§1), not iconv-lite |
| Excel read and write | read-excel-file, write-excel-file | 9.3.12, 4.1.1 | MIT | hand-written `lib/xlsx.ts` writer, and no Excel import at all (RC-117) |
| PDF read (bank statements) | unpdf | 1.9.1 | MIT | same library (2.x is too new). It **bundles pdf.js** (`pdfjs-dist` ~6.4.299) inside `dist/`, where audit and licence checks can't see it. That bundled version is recorded here, and pdf.js advisories are watched by version. Runs with `isEvalSupported: false` and the limits in §7 |
| PDF write (invoice, challan, receipt) | @react-pdf/renderer | 4.9.0 | MIT | browser print only (RC-152). Runs in the worker. Images and fonts only from Buffers (§7) |
| Mail (IMAP) | imapflow | 2.8.0 | MIT | same. Its own connection is a named exception (§7) |
| Mail parsing | mailparser | 3.12.2 | MIT | same. Text and attachments only; mail HTML is never rendered |
| Mail sender check (DKIM, DMARC) | mailauth | 8.0.4 | MIT | the hand-split `Authentication-Results` header and substring sender match (RC-144). DNS through a resolver with timeouts (§7) |

**Web**

| Need | Library | Version | Licence | Replaces in v1 |
|---|---|---|---|---|
| Framework | next | **16.4.5** (security release, §5) | MIT | same framework. Image optimisation is off (`images.unoptimized: true`), because files come from S3 by presigned URL, so `sharp` is never loaded |
| UI library | react, react-dom | 19.3.1 | MIT | same |
| UI primitives (dialog, popover, select, tabs, menu) | radix-ui | 1.8.1 | MIT | hand-made `Modal`, `Tabs`, menus in `ui.tsx` |
| Server data and writes | @tanstack/react-query | 5.104.5 | MIT | hand-written `useGet` cache and `useSaving` |
| Tables, long lists | @tanstack/react-table, @tanstack/react-virtual | 9.3.1, 3.14.21 | MIT | hand-made `Table` |
| Forms | react-hook-form, @hookform/resolvers | 7.90.0, 6.0.0 | MIT | hand-made `Form` internals |
| Combobox (server search) | cmdk | 1.1.1 | MIT | pickers that loaded a fixed slice (RC-086). Last release March 2025: stable and small (§4) |
| QR code for second-factor enrolment | qrcode | 1.5.4 | MIT | nothing (M1-15 is new). **Browser only**: it draws the `otpauth://` URI as SVG on the enrolment screen, so the secret never goes to an outside QR service. The SVG is shown through an `<img>` with a `data:` URL, not inserted as HTML (ADR-002 L6); web's Content-Security-Policy, set in `apps/web/proxy.ts` (M1-46), allows `data:` images (`img-src 'self' blob: data:`). Last release August 2024: a finished, widely used library with no open advisory (§4). Its `yargs` dependency serves only its command-line tool and doesn't reach the browser bundle. Checked on npm and OSV on 7 Nov 2026, with its dependencies: no advisory. Row added ahead of the PR that installs it, by the coordinator's decision (RAD-61) |

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
| Next and React lint rules (includes `react/no-danger`) | eslint-config-next | **16.4.5** (Next's release set, §5) | MIT | none |
| Drizzle lint rules | eslint-plugin-drizzle | 0.2.3 | Apache-2.0 | none. Its stable is from 2023, but it is published from the Drizzle monorepo alongside 1.0 (§4) |
| Import boundaries | dependency-cruiser | 18.7.0 | MIT | none (ADR-001 D1 to D9) |
| Unused files, exports, dependencies | knip | 6.42.1 | ISC | none (RC-220) |

**`@types/*` packages** have no rows. Each is pinned exactly, and its major version equals that of the package it
types: `@types/node` 26.x for Node 26, `@types/pg` 8.x for pg 8, and so on. C6 checks this.

### 3. Written by us, on purpose

Each of these is small, is specific to Indian rules or to RadCore, and has no proven library. Each needs table-driven
tests worked from the source text:

- GSTIN format and checksum, PAN format, state code from GSTIN (M1-03).
- Place of supply and the GST split, the cess, the round-off (lib-gst).
- The common and breached password check (M1-14, RAD-32, ADR-001 §7a), on the platform.
  - **A bundled list**, always checked. It is a data file in lib-platform: the entries of 15 or more characters
    from a public common-password list under MIT or CC0 (SecLists' 10-million list is MIT), with its licence
    notice beside it.
  - **Then the Pwned Passwords range API**, over the outbound client. An npm client for it would make its own
    `fetch`, which L8 forbids, and the call is a single GET of `/range/<5 hex>` with a line-by-line read of the
    answer.
  - Its tests run on a fake transport and never reach the network.
- The outbound guard (ADR-002 L8), on the platform. It uses `node:https` with a custom `lookup` that resolves the
  host and checks the address against a `net.BlockList` of every non-global range (ADR-002's list). The connection
  is pinned to the checked address, and redirects are followed by hand.
- Upload magic bytes (M1-25, RAD-43), on the platform. Each allowed kind has one signature at fixed offsets in the
  file's first 1 KB, checked against the kind the upload declared: JPEG, PNG, WebP, HEIC (by `ftyp` brand), PDF, and
  ZIP for XLSX. A CSV has no signature and must have no NUL byte there. It confirms, it doesn't detect. file-type was
  the library option, but it recognises hundreds of kinds and inflates ZIP entries in the request process, outside
  the import isolate (§7). Whether a ZIP is really a workbook is the import parser's question (RAD-46).

What is **not** ours:
- **The CSV formula guard** is csv-stringify's `escape_formulas: true`. It covers `=`, `+`, `-`, `@`, tab, CR and
  their full-width forms. A cell that is a strict decimal, date or E.164 phone string (`^-?\d+(\.\d+)?$`,
  `^\d{4}-\d{2}-\d{2}$`, `^\+[1-9]\d{7,14}$`) can't be a formula: it has no letters or brackets, so a spreadsheet
  can at most read it as a number. For those cells the export's `cast` returns `{ value, escape_formulas: false }`,
  which csv-stringify applies to that cell alone, so `-1250.50` stays a number and a phone gets no apostrophe
  (RC-203). A spreadsheet may show such a phone as a number without its `+`, but the file holds the exact text.
  Every other cell is escaped. M1-29 tests each case, including `+91abc` and a full-width `＋91…` still escaped.
- **Envelope encryption** is the AWS Encryption SDK (§2).

### 4. Adding or changing a dependency

A dependency is added in the PR that first needs it. **That PR also adds its row to §2.** No row, no merge.

- **Who approves.** The architect reviews the row, the auditor checks it, and the coordinator approves by merging.
  A new runtime dependency (not dev-only) is called out in the PR description.
- **Before proposing one:** the need can't be met by the platform or a library already listed (§1). The library
  is used for more than a few lines' worth of work.
- **Licence** (every package in the lockfile, transitives included):
  - Allowed: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0.
  - MPL-2.0 is allowed only for dev-only packages used unmodified.
  - Refused: GPL, AGPL, LGPL, SSPL, and any other licence, a missing `license` field, or an SPDX expression.
  - The only way past a refusal is a row in the **transitive exceptions** table below, which names the package,
    the licence, the reason and, for an expression, the licence chosen.

  | Package | Licence | Why it's allowed |
  |---|---|---|
  | `caniuse-lite` (via browserslist) | CC-BY-4.0 | a data file of browser support tables; attribution is kept in the image's notices |
  | `argparse` (via eslint's js-yaml) | Python-2.0 | permissive; dev tooling only |
  | `type-fest` (via pg-boss's serialize-error) | `(MIT OR CC0-1.0)`; chosen: MIT | TypeScript type declarations only, no runtime code; both licences are permissive (RAD-44) |
  | `@img/sharp-libvips-*` (via next's optional `sharp`) | LGPL-3.0-or-later | an unmodified, dynamically linked prebuilt binary. It is never loaded, because image optimisation is off (§2), and the image ships its licence notice. **Confirm with Sarthak.** The alternative is a build that leaves it out |
  | `@img/sharp-win32-*`, `@img/sharp-wasm32` (same `sharp`, bundling libvips) | `Apache-2.0 AND LGPL-3.0-or-later` (wasm32 adds `AND MIT`); chosen: all of them apply | the same libvips binary as the row above, so it stands or falls with it. Added by RAD-13 from the real lockfile |
  | `language-subtag-registry` (via eslint-config-next's `eslint-plugin-jsx-a11y`) | CC0-1.0 | a public-domain data file of language tags; dev tooling only. Added by RAD-13 from the real lockfile |

- **Maintenance:** a release in the last 12 months, or a stated reason in its row (decimal.js, pino-http, cmdk and
  eslint-plugin-drizzle carry one). It must have no open advisory without a fix (C5). Its install scripts, if any,
  are on the allowlist in §6.
- **Age:** the exact version, and every transitive version it adds, is at least 14 days old, unless it fixes a
  published security advisory. In that case the exception is named in §5 (C9).
- **Pinning:** exact versions in `package.json` (C3), with the lockfile committed.
- **Our own packages.** The `@radcore/*` workspaces are referenced only as `"*"` and must resolve to the local
  workspace (`link: true` in the lockfile, C3). The `@radcore` scope is claimed on npm as a free organisation, so
  nobody else can publish under it and confuse an install (Sarthak, 7 Nov 2026; the coordinator confirmed it on the
  registry). Every workspace is `"private": true`, so nothing is published to it either, and `.npmrc` needs no
  scope mapping: the one registry it names is npm's.
- **Dependabot (RAD-16):** when M0-07 adds the npm entry, it gets `cooldown: { default-days: 14 }`. Security
  updates aren't held back by it. The Docker ecosystem entry for the Node image (added with the Dockerfile, M8)
  has **no** cooldown, because Node patches are taken at once (§5). M0-07 checks:
  - that GitHub accepts the config;
  - that Dependabot alerts and security updates are still on (switched on in RAD-6).

  A major version update gets its own ticket.

### 5. Node and the two exceptions

- **Node 26.13.0.** Node 26 became the Active LTS line ("Lithium") in late October 2026, with maintenance until
  April 2029. Node 24 is now in maintenance. The runtime follows Node's LTS line rather than the 14-day rule,
  because its releases are security-reviewed upstream and every LTS patch is taken.
  - `.nvmrc` holds `26.13.0`, and every workspace's `package.json` has `"engines": { "node": ">=26.13.0 <27" }`.
  - `.npmrc` has `engine-strict=true`, so `npm ci` refuses another Node.
  - The Docker image (ADR-004) uses the same version.
  - M0-07's proof (fresh clone, `npm ci`, `npm run dev`, `npm test`) runs on 26.13.0. If a listed library fails on
    Node 26, the fallback is Node 24 LTS ("Krypton", maintained to April 2028), changed in this ADR, not worked
    around in code.
- **Next's 16.4.5 release set** (3 Nov 2026) is taken at once. It fixes the advisories published that day for
  Next 16.4.x (among them GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8). Holding it back two weeks would keep a
  known hole open.
  - The exception covers the packages Vercel published as that release: `next`, `eslint-config-next`,
    `@next/env`, `@next/eslint-plugin-next` and the `@next/swc-*` binaries.
  - `eslint-config-next` must match `next`'s version.

**A known advisory C5 lets through (not an exception):**
- `esbuild` 0.18.20, pulled in by drizzle-kit through `@esbuild-kit/core-utils`, is in the range of
  GHSA-67mh-4wv8-2f99. That advisory is moderate: esbuild's dev server answers requests from any website.
- It's a dev dependency, used only when drizzle-kit generates migrations. Its dev server is never started or
  served, so C5's moderate threshold for production packages doesn't apply.
- Recheck it when drizzle-kit is upgraded.

### 6. The install path

The rules above mean nothing if installing runs someone else's code. So:

- **`.npmrc`:**
  - `ignore-scripts=true`, so no lifecycle script runs on `npm ci`;
  - `registry=https://registry.npmjs.org/`;
  - `save-exact=true` and `engine-strict=true`.
- **Install scripts by allowlist.** A package that needs its install script is named, with the reason, in
  `tools/install-scripts.json`. After `npm ci`, CI runs `npm rebuild` for those packages only. Today that list is
  expected to be empty or close to it: esbuild, @node-rs/argon2, sharp and the `@next/swc-*` binaries all ship
  prebuilt platform packages. M0-07 fills it from the real lockfile.
- **Audit before install.**
  - `npm audit --package-lock-only` runs on the lockfile **before** `npm ci`, covering dev packages too, because
    lint, tests and Stryker run in CI with tokens.
  - After the install, `npm audit signatures` checks the registry signatures.
- **The lockfile is checked itself** (C8). Every `resolved` URL must be on the registry above, every `integrity`
  must be sha512, and the lockfile must be version 3.

### 7. Libraries that do their own I/O

ADR-002's L8 sends every outside call through the guarded client. Lint can't see inside a library, so each library
that opens a connection or fetches something is named here with its rule:

| Library | What it does on its own | Rule |
|---|---|---|
| pg, pg-boss, rate-limiter-flexible | connect to PostgreSQL | only the pools built in `lib-platform/src/db/client.ts`, from `DATABASE_URL`, are allowed (ADR-002 L4) |
| @aws-sdk/client-s3 | connects to S3 | the endpoint comes only from settings (`S3_REGION`, SeaweedFS's `S3_ENDPOINT` in development), never from data |
| @aws-crypto/client-node | calls KMS | the key comes only from `SECRETS_KMS_KEY_ID` |
| imapflow | connects to the statements mailbox | the host is set by an admin, checked against the global-unicast rule before connecting, TLS only, with connection and idle timeouts |
| mailauth | DNS lookups on the sender's domain | a `node:dns` `Resolver` with a timeout and a limited number of tries, passed in as its resolver |
| @react-pdf/renderer | would fetch `<Image src>` and `Font.register` URLs | images and fonts are passed **only as Buffers** read from the file store or bundled with the app. Our `PdfImage` wrapper accepts a Buffer only, and no template uses a URL |

**Parser limits** (M1-28, untrusted files):
- **Imports:**
  - a file is at most 25 MB;
  - a CSV or Excel import has at most 50,000 rows;
  - an Excel file unzips to at most 100 MB, in at most 1,000 entries;
  - a PDF is at most 15 MB and 200 pages, read in 30 seconds.
- **Mail:** a message is at most 30 MB, with at most 10 attachments.
- **Encoding detection:** chardet reads only a file's first 64 KB.
- **Isolation:** each file is parsed in a `worker_threads` worker with `resourceLimits` and no database or S3
  credentials.

## CI checks (for M0-08)

| # | Check | Fails when |
|---|---|---|
| C1 | `knip` | a dependency is declared and not used, used and not declared, or a file or export is unused |
| C2 | Node version | any of these differ from `.nvmrc`'s version (`v`): the `engines` value in any workspace (it must equal `>=v <major+1>`), `engine-strict` in `.npmrc`, the Docker base image tag, or `node --version` in CI |
| C3 | exact pins | in `dependencies`, `devDependencies`, `optionalDependencies` or `overrides`, a version that isn't an exact `semver.valid()` string (`^`, `~`, ranges, `x`, `latest`, `\|\|`, `git+`, `github:`, URLs, `file:`, `npm:` aliases all fail). The one exception is an `@radcore/*` entry of `"*"` that the lockfile shows as `link: true`. `engines` isn't a dependency field, so its range is allowed |
| C4 | licences | any package in `package-lock.json` has a missing licence, an SPDX expression, or a licence outside §4's list, and isn't in the transitive exceptions table. MPL-2.0 passes only for dev packages. A short script over the lockfile; no extra dependency |
| C5 | advisories | `npm audit --package-lock-only` reports **high** or worse in any package, dev included, or **moderate** or worse in a production package |
| C6 | list and lockfile agree | a direct dependency in any `package.json` has no row in §2 (except `@radcore/*` and `@types/*`); its version differs from the row; or an `@types/*` major differs from its package's major. A test reads this file's tables |
| C7 | install scripts | a lockfile entry with `hasInstallScript` isn't in `tools/install-scripts.json` |
| C8 | lockfile integrity | a `resolved` URL isn't on `https://registry.npmjs.org/`, an `integrity` isn't sha512, or `lockfileVersion` isn't 3 |
| C9 | age | a lockfile entry added or changed by the PR (compared with the base branch's lockfile) was published less than 14 days before the PR, and isn't covered by a named exception in §5. Transitives included |
| C10 | signatures | `npm audit signatures` after `npm ci` reports an invalid or missing registry signature |

**Fixtures.** Each clause of each check has a violating fixture in `tools/boundary-fixtures/`, run on every CI build
like ADR-001's:
- C1: an unused dependency;
- C2: a wrong `engines` value;
- C3: a `^` range, an `npm:` alias, and an `@radcore/*` entry without `link: true`;
- C4: a GPL package, MPL in production, a missing licence, and an SPDX expression;
- C5: a fixture lockfile with a known high advisory;
- C6: an unlisted dependency, a version mismatch, and an `@types/*` major mismatch;
- C7: an unlisted install script;
- C8: an off-registry `resolved`, and a sha1 `integrity`;
- C9: a fresh version.

## Consequences

- Most of v1's hand-written plumbing is replaced by the list above. What stays ours is listed in §3 and gets
  table-driven tests.
- Every dependency has a written reason and an owner. CI refuses one that is unused, unpinned, unlisted, wrongly
  licensed, too new, off-registry or running an unlisted install script.
- Two upgrades are waiting and named: TypeScript 7 (typescript-eslint support) and ESLint 10 (eslint-plugin-react
  support). So is Drizzle 1.0, when it's stable.
- Sarthak's two actions are done: the `@radcore` npm scope is claimed (7 Nov 2026), and the sharp/libvips licence
  exception is accepted (§4, 6 Nov 2026).

## Alternatives considered

- **exceljs** for Excel: its last release was October 2023. read-excel-file and write-excel-file are maintained.
- **SheetJS (`xlsx`) from npm:** the npm copy is out of date. Newer builds are published only on its own site.
- **papaparse** for CSV: it detects delimiters well, but has no streaming writer. csv-parse and csv-stringify come
  from one project and stream both ways.
- **argon2** (node-argon2): it builds with node-gyp; @node-rs/argon2 ships prebuilt binaries.
- **otplib:** larger. otpauth covers RFC 4226 and 6238 in one small package.
- **Our own envelope encryption over `node:crypto`:** the AAD binding, IV limits, tag checks, key versions and
  rotation would all be ours to get right. The AWS Encryption SDK does them, with encryption context and key
  commitment.
- **pdfjs-dist directly instead of unpdf:** it would be visible to audit, but unpdf's serverless build and text
  API save code. It's kept, and its bundled pdf.js version is recorded.
- **tsx, iconv-lite and @date-fns/tz:** each is covered by the platform (§1).
- **PGlite for tests:** it's a different engine with one connection, which hid locking bugs in v1 (RC-154).
- **Tailwind or shadcn tooling:** not adopted (Design notes A3). Radix primitives sit under our own components.
