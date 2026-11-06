# RadCore v2 documents

What each file is, and which one decides when two disagree.

## Sources of truth

| Question | The file that decides |
|---|---|
| What is in scope, in what order, which ticket does what | [plan.md](plan.md), the v2 plan Sarthak approved on 5 Nov 2026 |
| Which v1 defects v2 must design out, and which ticket proves each | [register.md](register.md), RC-001 to RC-222 |
| What must be true before real data and go-live | [source/07-Go-Live-Checklist.md](source/07-Go-Live-Checklist.md), GL-001 to GL-248 |
| How the code is shaped, and why | the decision records in [architecture/adr/](architecture/adr/) |
| What was decided after the plan was approved | [decisions.md](decisions.md), one dated line per decision |

plan.md is the record of what was approved on 5 Nov 2026 and isn't edited. **Where decisions.md or an ADR
differs from plan.md, decisions.md and the ADR win.** For example, the plan's single `packages/core` became
module-wise libraries under N2 (ADR-001). Tickets in Linear carry the exact acceptance criteria; when one changes,
its Notes say so.

## Files

| File | What it is |
|---|---|
| [plan.md](plan.md) | The approved v2 plan: decisions N1 to N4, milestones M0 to M9, every ticket with its acceptance criteria, the open owner decisions (D-xx), and the coverage index from register item to ticket. Unchanged since approval, except that a personal email address was blanked (RAD-18). |
| [decisions.md](decisions.md) | Every decision since the plan was approved (N5, D-19, D-20 and the rest): who decided, and where it is applied. |
| [register.md](register.md) | All 222 v1 register items with wave, level, title and the v2 ticket that covers each. Built from the plan's coverage index and the fix plan's register. |
| [architecture/](architecture/) | The package diagram and the ADRs (layers, data access, libraries, runtime, database). |
| [source/00-RadCore-application-plan.md](source/00-RadCore-application-plan.md) | The RadCore application plan (PDF of 4 Nov 2026): the business, its roles, and the 12 user flows. |
| [source/02-Technical-Report.md](source/02-Technical-Report.md) | The technical review of v1: method, scorecard, the twelve cross-cutting themes, the 25 findings that matter most. |
| [source/03-Fix-Plan.md](source/03-Fix-Plan.md) | The v1 register in full (fix, proof, effort and wave for each RC item). It describes v1; v2 uses it as the list of defects to design out. |
| [source/05-Hosting-Recommendation.md](source/05-Hosting-Recommendation.md) | The hosting options and costs, and the recommended AWS Mumbai hybrid (decision D-01, ADR-004). |
| [source/06-Frontend-and-AI-Design-Notes.md](source/06-Frontend-and-AI-Design-Notes.md) | The front-end redesign plan, component and token choices, offline counter, push alerts, and AI readiness. |
| [source/07-Go-Live-Checklist.md](source/07-Go-Live-Checklist.md) | The go-live checklist (GL-001 to GL-248), held by the M8 gate tickets. |
| [source/08-Handover-Call-Pack.md](source/08-Handover-Call-Pack.md) | The handover call pack and the owner decisions D-01 to D-23. |
| [source/10-Questions-for-CA-and-Counsel.md](source/10-Questions-for-CA-and-Counsel.md) | Questions for the chartered accountant and counsel (CA-xx). |

## Reading the source documents

- They review **v1**: the code on the `erp/main` branch. File and line references in them (`sales.ts:302`) point at
  v1, which stays read-only reference for behaviour (N4).
- They are Markdown copies of the documents Sarthak received. They aren't edited here. A correction to one goes in
  a ticket, the plan or an ADR.
- **The restricted security appendix (02b) is not in this repository** and never will be. It is not in git, Linear
  or any PR. The other documents mention it by name only. `.gitignore` names it so a copy can't be added by
  accident. Its findings are tracked here by RC number alone.
