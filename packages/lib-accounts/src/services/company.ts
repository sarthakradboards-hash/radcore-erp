// The company profile (M2-02, RAD-88; D-02 option A, ADR-001 §5): RadCore keeps one legal entity's books. Its one row
// is set as a whole, and the database refuses a second (accounts.company's id is fixed at 1, RC-010). Invoicing asks
// companyForInvoice first, so nothing is invoiced before the GSTIN, address and state are set, and the state is
// always the GSTIN's own: there is no default to fall back on (RC-112).
import { accountsTx, company } from '@radcore/db/accounts';
import { AppError, type Ctx } from '@radcore/lib-platform';
import type { z } from 'zod';
import type { getCompany, setCompany } from '../contract.ts';

type Company = NonNullable<z.input<typeof getCompany.output>['company']>;

const ONE = 1;
const columns = {
  legalName: company.legalName, gstin: company.gstin, stateCode: company.stateCode, addressLine1: company.addressLine1,
  addressLine2: company.addressLine2, city: company.city, pincode: company.pincode,
};

/** GET /admin/company (company:read): the profile, or null until it's set. */
export async function getCompanyProfile(ctx: Ctx): Promise<z.input<typeof getCompany.output>> {
  const [row] = await accountsTx(ctx).select(columns).from(company).limit(1);
  return { company: row ?? null };
}

/** PUT /admin/company (company:write): the profile, set whole. The first set creates the one row; later sets change
 * it. The reason was kept by the handler before this runs, so the audit rows point at it. */
export async function setCompanyProfile(ctx: Ctx, input: z.output<typeof setCompany.input>): Promise<z.input<typeof setCompany.output>> {
  const { legalName, gstin, addressLine1, addressLine2, city, pincode } = input;
  const values = { legalName, gstin, addressLine1, addressLine2, city, pincode };
  const [row] = await accountsTx(ctx).insert(company).values({ id: ONE, ...values })
    .onConflictDoUpdate({ target: company.id, set: values }).returning({ stateCode: company.stateCode });
  if (row === undefined) throw new Error('The company profile was not saved');
  return { stateCode: row.stateCode };
}

/**
 * The seller's details for an invoice, read in the invoice's own transaction (M3 calls this before it numbers one).
 * Until the profile is set it refuses with `company_profile_incomplete`, which the invoice's contract lists (RC-112).
 */
export async function companyForInvoice(ctx: Ctx): Promise<Company> {
  const [row] = await accountsTx(ctx).select(columns).from(company).limit(1).for('share');
  if (row === undefined) {
    throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state before invoicing');
  }
  return row;
}
