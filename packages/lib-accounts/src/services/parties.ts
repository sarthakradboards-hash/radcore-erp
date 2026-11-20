// Parties (M2-11, RAD-90; ADR-001 §5: lib-accounts'): customers, dealers, franchisees and suppliers. The handler masks
// the personal fields for a principal without pii:read and logs the looks (RAD-40); these services read and write the
// stored values. A phone is kept as E.164 and an email in lower case, so a party is found the same way however it was
// typed. Every write is audited by the table's trigger, with the personal columns redacted.
import { accountsTx, after, parties, searchWords } from '@radcore/db/accounts';
import { normaliseEmail, normalisePhone } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { PARTY_KINDS, partyTaxIssues, type createParty, type getParty, type listParties, type setPartyCredit, type updateParty } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const columns = {
  id: parties.id, name: parties.name, customer: parties.customer, dealer: parties.dealer, franchisee: parties.franchisee,
  supplier: parties.supplier, gstin: parties.gstin, pan: parties.pan,
  composition: parties.composition, stateCode: parties.stateCode, phone: parties.phone, email: parties.email,
  addressLine1: parties.addressLine1, addressLine2: parties.addressLine2, city: parties.city, pincode: parties.pincode,
  creditDays: parties.creditDays, creditLimit: parties.creditLimit, active: parties.active,
};
type Kind = (typeof PARTY_KINDS)[number];
type KindFlags = Record<Kind, boolean>;
/** A stored row, its four kind flags answered as the contract's list of kinds. */
const answer = <R extends KindFlags>({ customer, dealer, franchisee, supplier, ...r }: R) =>
  ({ ...r, kinds: PARTY_KINDS.filter((k) => ({ customer, dealer, franchisee, supplier })[k]) });
/** The contract's list of kinds as the four columns, or nothing when it isn't being set. */
const flags = (kinds: readonly Kind[] | undefined): Partial<KindFlags> =>
  (kinds === undefined ? {} : Object.fromEntries(PARTY_KINDS.map((k) => [k, kinds.includes(k)])));
/** A party's own fields, picked by name from what was sent: never the input spread whole, so a caller that skips the
 * contract can't set credit terms or anything else through create or change (the auditor on #180). */
const OWN = ['name', 'gstin', 'pan', 'composition', 'stateCode', 'phone', 'email', 'addressLine1', 'addressLine2', 'city', 'pincode'] as const;
type Own = Pick<In<typeof createParty>, (typeof OWN)[number]>;
const own = (p: { [K in keyof Own]?: Own[K] | undefined }): Partial<Own> =>
  Object.fromEntries(OWN.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) as Partial<Own>;

/** The stored forms of a phone and an email. */
const stored = <T extends { phone?: string | null | undefined; email?: string | null | undefined }>(p: T): T => ({
  ...p,
  ...(p.phone === undefined ? {} : { phone: p.phone === null ? null : (normalisePhone(p.phone) ?? null) }),
  ...(p.email === undefined ? {} : { email: p.email === null ? null : normaliseEmail(p.email) }),
});

/** ux_parties_gstin's refusal, as the contract's error. */
async function gstinOnce<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (e) {
    if ((e as { cause?: { constraint?: string } }).cause?.constraint === 'ux_parties_gstin') {
      throw new AppError('gstin_taken', 'Another party already has this GSTIN', [{ path: ['gstin'], code: 'taken', message: 'Check the GSTIN' }]);
    }
    throw e;
  }
}

/** GET /parties: by name, then id, so a page key is unique and paging never skips or repeats. */
export async function listPartiesPage(ctx: Ctx, input: In<typeof listParties>): Promise<Out<typeof listParties>> {
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ name: z.string().max(200), id: z.uuid() }), input.after);
  const { search, kind, active } = input.filter;
  const words = searchWords([parties.name], search);
  const rows = await accountsTx(ctx).select(columns).from(parties)
    .where(and(
      words === undefined ? undefined : or(words, eq(parties.gstin, (search ?? '').trim().toUpperCase())),
      kind === undefined ? undefined : eq(parties[kind], true),
      active === undefined ? undefined : eq(parties.active, active),
      after([parties.name, parties.id], key && [key.name, key.id], 'asc'),
    ))
    .orderBy(asc(parties.name), asc(parties.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map(answer), next: rows.length > input.limit && last ? encodeCursor({ name: last.name, id: last.id }) : null };
}

/** GET /parties/:id. */
export async function getPartyById(ctx: Ctx, { id }: In<typeof getParty>): Promise<Out<typeof getParty>> {
  const [row] = await accountsTx(ctx).select(columns).from(parties).where(eq(parties.id, id)).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There is no such party');
  return answer(row);
}

/** POST /parties. */
export async function addParty(ctx: Ctx, input: In<typeof createParty>): Promise<Out<typeof createParty>> {
  // The contract checks these too; a service called from another library gets the same refusal, not a CHECK's.
  const issues = partyTaxIssues(input);
  if (issues.length > 0) throw new AppError('invalid_input', 'Check the party’s GSTIN, PAN and state', issues);
  const values = { ...(stored(own(input)) as Own), ...flags(input.kinds) };
  const [row] = await gstinOnce(accountsTx(ctx).insert(parties).values(values).returning({ id: parties.id }));
  if (row === undefined) throw new Error('The party was not saved');
  return row;
}

/** PATCH /parties/:id: the tax rules are checked on the party as it will be, under its row lock: NO KEY UPDATE, as an
 * edit never changes the key, so documents that reference the party aren't held up (ADR-006 §1 step 3). */
export async function changeParty(ctx: Ctx, { id, ...change }: In<typeof updateParty>): Promise<Out<typeof updateParty>> {
  const tx = accountsTx(ctx);
  const [now] = await tx.select({ gstin: parties.gstin, pan: parties.pan, stateCode: parties.stateCode, composition: parties.composition })
    .from(parties).where(eq(parties.id, id)).limit(1).for('no key update');
  if (now === undefined) throw new AppError('not_found', 'There is no such party');
  const issues = partyTaxIssues({ gstin: change.gstin === undefined ? now.gstin : change.gstin, pan: change.pan === undefined ? now.pan : change.pan,
    stateCode: change.stateCode ?? now.stateCode, composition: change.composition ?? now.composition });
  if (issues.length > 0) throw new AppError('invalid_input', 'Check the party’s GSTIN, PAN and state', issues);
  const fields = { ...stored(own(change)), ...flags(change.kinds), ...(change.active === undefined ? {} : { active: change.active }) };
  if (Object.keys(fields).length > 0) await gstinOnce(tx.update(parties).set(fields).where(eq(parties.id, id)));
  return {};
}

/** PUT /parties/:id/credit (parties:manage): the reason was kept by the handler before this runs. */
export async function setCreditTerms(ctx: Ctx, { id, creditDays, creditLimit }: In<typeof setPartyCredit>): Promise<Out<typeof setPartyCredit>> {
  // The route checks this key; a caller from another library is checked here too, so credit terms need it either way.
  if (!ctx.can('parties:manage')) throw new AppError('forbidden', 'Setting credit terms needs parties:manage');
  const done = await accountsTx(ctx).update(parties).set({ creditDays, creditLimit }).where(eq(parties.id, id)).returning({ id: parties.id });
  if (done.length === 0) throw new AppError('not_found', 'There is no such party');
  return {};
}

/**
 * ADR-006 §1's step 3: the party whose credit a sale checks, held `FOR NO KEY UPDATE` after the stage has locked its own
 * documents and before checkSale, so two sales to one party take turns at the credit check (ADR-007 §9) instead of
 * both passing on the same balance. `NO KEY`, so inserts that reference the party by foreign key (`KEY SHARE`) don't
 * wait on it. A party that isn't there answers not_found.
 */
export async function holdParty(ctx: Ctx, partyId: string): Promise<void> {
  const [row] = await accountsTx(ctx).select({ id: parties.id }).from(parties).where(eq(parties.id, partyId)).limit(1).for('no key update');
  if (row === undefined) throw new AppError('not_found', 'There is no such party');
}
