// The checks every sale goes through (M3-07, RAD-111; RC-061, RC-131), and the one way to override them. Each stage
// that commits a sale (confirming an order, a delivery, an invoice, handing back a repaired vehicle) asks checkSale
// again, so a party that went over its limit or fell overdue since the order is stopped at the next step too.
// - Credit: the party's exposure is its net Debtors balance, plus what it has been delivered and not billed, plus this
//   document; over its limit, or with a bill past its credit days, needs someone else's approval. A party with no limit
//   set has no credit, and one with no days of its own has accounts.default_credit_days (Sarthak on RAD-111).
// - Price, only on lines with a price set: below the item's average cost at the place (the moving average, landed
//   cost included; the purchase price when nothing is on hand), or below the list rate by more than the person's
//   discount limit (RAD-98, 0% by default), needs approval: the document's maker's limit, whoever reads it. A stock item
//   with no cost at all needs it too.
// The arithmetic is checks-rules.ts's. An override goes through defineApproval (RAD-38) with overrideApproval below.
import { dec, type DecimalInput, type Money } from '@radcore/lib-common';
import { DEFAULT_CREDIT_DAYS, getPartyById, partyReceivable } from '@radcore/lib-accounts';
import { AppError, roleOf, versionHash, type ApprovalSpec, type ApprovalVersion, type Ctx } from '@radcore/lib-platform';
import { averageCost, purchasePrices } from '@radcore/lib-stock';
import type { z } from 'zod';
import type { saleCheck } from '../contract/checks.ts';
import { costResult, creditResult, discountPercent, issuesOf, noListRate, overDiscount, type CheckIssue } from './checks-rules.ts';
import { counterCustomer } from './delivered.ts';
import { discountLimitOf } from './discounts.ts';

/** The stages a sale is checked at (RC-061). */
export type SaleStage = 'confirm' | 'deliver' | 'invoice' | 'handback';

/** One line of the sale, as the document holds it. */
export type SaleLine = Readonly<{
  itemId: string;
  /** Where it's sold from; null: the sellable places together. */
  locationId: string | null;
  /** The rate after discount, per base unit, before GST (the architect on RAD-111); null where no price is set at this
   * stage, so no price check runs. */
  rate: DecimalInput | null;
  /** The list rate on the same basis; null: no list price, so no discount is judged. */
  listRate: DecimalInput | null;
}>;

/** What a stage asks about. */
export type SaleCheck = Readonly<{
  stage: SaleStage;
  partyId: string;
  /** The document's business date. */
  on: string;
  /** What this document adds to what the party owes, counted once with notInvoiced: at confirm, the order's total; at
   * deliver, this delivery's value (not yet posted, so not in notInvoiced); at invoice, only what the invoice adds beyond
   * its deliveries, which notInvoiced already holds; at handback, the job card's unpaid total. */
  adds: DecimalInput;
  /** Delivered to the party and not yet billed: the stage passes delivered.ts's deliveredNotInvoiced. */
  notInvoiced?: DecimalInput;
  /** A held quick bill's planned payments, not yet taken, off what's owed, so its override is judged as completing it
   * will be, with its receipts taken first (the architect on RAD-115). Only the hold's override passes it. */
  paidNow?: DecimalInput;
  lines: readonly SaleLine[];
  /** Who priced it: the document's maker (its created_by, "user:<id>"). Its discounts are judged by their role's limit,
   * never the reader's, so the maker, an override's approver and whoever confirms or posts it see the same issues
   * (the architect on RAD-112). */
  pricedBy: string;
}>;

/** The answer, in the contract's shape: every figure, each line's result, and the issues that need approval. */
export type SaleCheckResult = z.input<typeof saleCheck>;

/** Checks a sale at one stage. It reads, and changes nothing. */
export async function checkSale(ctx: Ctx, s: SaleCheck): Promise<SaleCheckResult> {
  const party = await getPartyById(ctx, { id: s.partyId });
  // The Counter customer's bill is paid in full before it's confirmed (walk_in_pays_in_full), so it has no credit to judge:
  // nothing owed, nothing added, and its history isn't read (delivered.ts's counterCustomer says why that holds).
  const walkIn = await counterCustomer(ctx, s.partyId);
  const owed = walkIn ? { outstanding: '0.00', oldestUnpaid: null } : await partyReceivable(ctx, s.partyId, s.on);
  const notInvoiced = dec(s.notInvoiced ?? '0').toFixed(2);
  const outstanding = dec(owed.outstanding).minus(dec(s.paidNow ?? '0')).toFixed(2);
  const credit = creditResult({ limit: party.creditLimit, outstanding, notInvoiced, adds: walkIn ? '0.00' : s.adds,
    creditDays: party.creditDays ?? ctx.settings.get(DEFAULT_CREDIT_DAYS), oldestUnpaid: owed.oldestUnpaid, on: s.on });
  const priced = s.lines.filter((l) => l.rate !== null);
  const limit = priced.length === 0 ? '0' : await discountLimitOf(ctx, await roleOf(ctx, s.pricedBy));
  // The average at the place, else the item's purchase price; each read once per line.
  const averages = await Promise.all(s.lines.map((l) => (l.rate === null ? null : averageCost(ctx, l.itemId, l.locationId))));
  const missing = s.lines.filter((l, i) => l.rate !== null && averages[i] === null).map((l) => l.itemId);
  const prices = missing.length === 0 ? new Map<string, string | null>() : await purchasePrices(ctx, missing);
  const lines = s.lines.map((l, i) => {
    if (l.rate === null) return { itemId: l.itemId, cost: null, check: 'not_priced' as const, discount: '0.000000', overDiscount: false };
    const cost = averages[i] ?? prices.get(l.itemId) ?? null;
    return { itemId: l.itemId, cost, check: costResult(l.rate, cost), discount: discountPercent(l.listRate, l.rate),
      overDiscount: overDiscount(l.listRate, l.rate, limit) };
  });
  return {
    stage: s.stage,
    credit: { limit: party.creditLimit, outstanding, notInvoiced, adds: dec(s.adds).toFixed(2) as Money,
      after: credit.after, overLimit: credit.overLimit, overdue: credit.overdue, oldestUnpaid: owed.oldestUnpaid },
    lines,
    // A priced line with no list rate needs approval too (the architect's #256), as one with no cost does.
    issues: issuesOf(credit, lines.map((l, i) => ({ cost: l.check === 'not_priced' ? 'ok' : l.check,
      noListRate: noListRate(s.lines[i]?.rate ?? null, s.lines[i]?.listRate ?? null), overDiscount: l.overDiscount }))),
  };
}

/**
 * What a held quick bill's approved order override lets its own delivery and invoice through on, in completing it (the
 * architect on RAD-115): the order, the kinds of issue approved, and what was owed then. Library-only, never from a
 * route's input. A stage passes only with issues of those kinds and no more owed; the stage checks it's that order's
 * whole delivery, or the invoice of exactly that delivery.
 */
export type ApprovedThrough = Readonly<{ orderId: string; deliveryId?: string; kinds: readonly string[]; after: DecimalInput }>;

/** Whether a stage's check is covered by the order's approval: issues of approved kinds only, and owed no more. */
export const coveredBy = (through: ApprovedThrough, r: SaleCheckResult): boolean =>
  r.issues.every((i) => through.kinds.includes(i.code)) && dec(r.credit.after).lte(dec(through.after));

/** What an override's approver approves, by its hash: the document's own figures, and the issues it overrides. No
 * balance or cost goes in, so the version doesn't move while it's decided, and an approver without cost:read can still
 * decide it (the figures behind a cost issue are cost(), in checkSale's answer). */
export type OverrideVersion = { figures: ApprovalVersion; issues: CheckIssue[] };

/**
 * The approval spec for overriding a sale's checks (RAD-38, ADR-001 §8b), for each kind of document to mount with
 * defineApproval and its own approvalContracts. The document says how to read its figures and what it asks checkSale;
 * the issues are worked out as the request is made and as it's decided, so a party that paid in between, or a price that
 * changed, makes the version change and the request go stale (version_changed). `approved` only records that the
 * override was granted: the document posts later, so nothing approving does moves what was approved.
 */
export function overrideApproval(o: Readonly<{
  kind: string;
  table: string;
  parts?: readonly string[];
  read: (ctx: Ctx, documentId: string, opts: { forUpdate: boolean }) => Promise<{ figures: ApprovalVersion; sale: SaleCheck } | null>;
  approved: ApprovalSpec<OverrideVersion>['approved'];
  rejected: ApprovalSpec<OverrideVersion>['rejected'];
}>): ApprovalSpec<OverrideVersion> & { judged(ctx: Ctx, id: string): Promise<Judged | null> } {
  return {
    kind: o.kind,
    table: o.table,
    ...(o.parts === undefined ? {} : { parts: o.parts }),
    async version(ctx, id, opts) {
      const doc = await o.read(ctx, id, opts);
      if (doc === null) return null;
      return { figures: doc.figures, issues: (await checkSale(ctx, doc.sale)).issues };
    },
    /** What approving records on the document: the version's hash, and what the party would owe after it (RAD-135).
     * shortcut: the figure is the decision's, worked out as it's decided, not the one the approver was shown, so a
     * balance grown in between is recorded at the larger figure (a small window; the architect on #338). Upgrade by
     * passing the shown figure on decide. */
    async judged(ctx, id) {
      const doc = await o.read(ctx, id, { forUpdate: false });
      if (doc === null) return null;
      const r = await checkSale(ctx, doc.sale);
      return { overrideVersion: versionHash({ figures: doc.figures, issues: r.issues }), overrideAfter: r.credit.after };
    },
    approved: o.approved,
    rejected: o.rejected,
  };
}

/** The columns an approval sets on its document, beside each other. */
export type Judged = { overrideVersion: string; overrideAfter: string };

/** An approved over_limit holds only for what the party would owe as it was judged (the architect on RAD-135): owing more
 * now, or no figure recorded, is asked again. A later change of the limit moves neither. */
export function refuseGrown(approvedAfter: string | null, r: SaleCheckResult, what: string): void {
  if (!r.issues.some((i) => i.code === 'over_limit')) return;
  if (approvedAfter !== null && dec(r.credit.after).lte(dec(approvedAfter))) return;
  throw new AppError('version_changed', `The party owes more than when this ${what} was approved: ask for its approval again`);
}
