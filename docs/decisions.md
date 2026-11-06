# Decisions since the plan was approved

[plan.md](plan.md) is the record of what Sarthak approved on 5 Nov 2026, and it isn't edited. Every decision taken
since goes here, one dated line each, with who decided it and where it is applied. Where this log or an ADR
differs from plan.md, this log and the ADR win.

| Date | Decision | Decided by | Applied in |
|---|---|---|---|
| 2026-11-05 | **N1.** Drizzle ORM, used as an ORM: no SQL strings in application code | Sarthak | [ADR-002](architecture/adr/002-data-access.md) |
| 2026-11-05 | **N2.** Module-wise libraries (lib-common plus one library per module), and proven npm libraries instead of hand-written code. This replaces the plan's single `packages/core` | Sarthak | [ADR-001](architecture/adr/001-layers.md), [ADR-003](architecture/adr/003-libraries.md) |
| 2026-11-05 | **N3.** `radcore-erp` is private | Sarthak | done on GitHub, 5 Nov |
| 2026-11-05 | **N4.** v2 lives only in `radcore-erp` on `dev`; v1 on `erp/main` is read-only reference for behaviour | Sarthak | [README](README.md), the plan |
| 2026-11-05 | Architecture documents and decision records live under `docs/architecture/` | Sarthak | `docs/architecture/adr/`; the RAD-7 to RAD-11 tickets |
| 2026-11-05 | **N5.** Stay on GitHub Free with no branch protection. The rule "nobody pushes to `dev` or `main`; only the coordinator merges" is kept by convention. RC-051 moves to M8-04 (deploy only tagged, green builds) | Sarthak | [CONTRIBUTING.md](../CONTRIBUTING.md), RAD-6, M8-04 |
| 2026-11-05 | gitleaks in CI in place of GitHub secret scanning, which Free doesn't offer for private repos | coordinator | `.github/workflows/secret-scan.yml` (RAD-6) |
| 2026-11-05 | Standing ticket **RAD-16** for Dependabot PRs: the auditor reviews them, e2e-playwright reviews too when they touch `apps/web` or a UI library, the coordinator merges, and a major update gets its own ticket | coordinator | CONTRIBUTING.md, RAD-16 |
| 2026-11-05 | `packages/lib-platform` (shared server-side pieces with I/O) and `apps/worker` added to the package list; masters and engines placed in lib-stock, lib-accounts, lib-gst and lib-platform | coordinator, on the architect's proposal | ADR-001 §1, §3 (RAD-7) |
| 2026-11-05 | The SQL zone: SQL is allowed in four places, all inside `packages/db` (migrations, views, schema CHECK and default expressions, the request-context helper). This is wider than the plan's "migrations and views" | coordinator, on the architect's proposal | ADR-002 §3 (RAD-8) |
| 2026-11-06 | Two exceptions to ADR-003's 14-day rule: Node 26.13.0 LTS, and Next's 16.4.5 security release set. Jobs are queued through an outbox in front of pg-boss | coordinator | ADR-003 §2, §5 (RAD-9); ADR-002 §4 |
| 2026-11-06 | **D-19.** The second sign-in factor (TOTP) is required for admin and owner only | Sarthak | ADR-003 (otpauth row); M1-15 |
| 2026-11-06 | **D-20.** Only admin and owner see salaries and bank details: those fields are `pii('pay')` and need `pay:read` | Sarthak | ADR-001 §7a (RAD-17); M1-22, M6-03 |
| 2026-11-06 | The Vercel team `acme-3a16` is Sarthak's. Its red check on PRs is noise until the v1 review copy is retired | Sarthak | ADR-004 §7 |
| 2026-11-06 | **RAD-17**: ADR-001 follow-ups from the ui, backend and auditor reviews, after RAD-7 merged | coordinator | ADR-001 (RAD-17) |
| 2026-11-06 | **RAD-18**: plan.md stays as approved, with only the personal email blanked; later decisions go in this log | coordinator, on the architect's advice | this file, [README](README.md) |
| 2026-11-06 | The **sharp/libvips licence exception** (LGPL-3.0-or-later) is accepted, as ADR-003 states it: Next's image optimisation stays off, so the binary is never loaded, and its licence notice ships in the image | Sarthak | [ADR-003](architecture/adr/003-libraries.md) §2, §4 |
| 2026-11-06 | **SeaweedFS** (Apache-2.0, pinned by digest) replaces MinIO as the S3-compatible server in development and CI, because MinIO's image can no longer be pulled anonymously. Production stays AWS S3. This supersedes "MinIO in dev" in plan.md (M0-07, M1-25) | coordinator | ADR-003, ADR-004 §1; RAD-13 |

**Still open**, and recorded here when decided:
- D-01 (hosting): ADR-004 is written on the Mumbai hybrid default.
- Claiming the `@radcore` npm scope (ADR-003 §4).
- The other D-items, by milestone, as listed in plan.md §4.
