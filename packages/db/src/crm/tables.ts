// lib-crm's tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { check, date, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';

/**
 * A lead (M3-02, RAD-106): one per phone number, in E.164, so a repeat enquiry joins the lead it repeats (RC-142). The
 * unique index is the lock on the number: two enquiries from one number at once wait for each other there, and the
 * second joins the first's lead. The owner is named as audit rows name a principal (`user:<id>`), null while no one
 * owns it (E7's own scope). Notes are staff's own words; what an outsider wrote is in lead_enquiries (RC-173).
 */
export const leads = radcoreTable('leads', {
  id: id(),
  phone: text().notNull(),
  name: boundedText({ max: 120 }),
  email: boundedText({ max: 254 }),
  owner: text(),
  followUpOn: date({ mode: 'string' }),
  /** Its latest enquiry's time: a repeat moves it, which locks the lead's row while the enquiry is saved. */
  lastEnquiryAt: timestamp({ withTimezone: true }).notNull(),
  notes: boundedText({ max: 2000 }),
}, (t) => [
  uniqueIndex('ux_leads_phone').on(t.phone),
  index('ix_leads_owner_follow_up').on(t.owner, t.followUpOn),
  check('ck_leads_phone', sql`${t.phone} ~ '^[+][1-9][0-9]{6,14}$'`),
  check('ck_leads_owner', sql`${t.owner} ~ '^user:[0-9a-f-]{36}$'`),
]);

/**
 * Each enquiry a lead made, the first one included: where it came from (by hand, at the counter, the website form, or
 * an ad or chat platform, M3-03) and when. `message` is the outsider's own text, kept as they wrote it and never in a
 * staff field, so nothing reads it as staff's words or as an instruction (RC-173); it's shown as text only.
 */
export const leadEnquiries = radcoreTable('lead_enquiries', {
  id: id(),
  leadId: uuid().notNull().references(() => leads.id),
  source: text().notNull(),
  message: boundedText({ max: 2000 }),
  receivedAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  index('ix_lead_enquiries_lead').on(t.leadId, t.receivedAt),
  check('ck_lead_enquiries_source', sql`${t.source} in ('manual', 'walk_in', 'form', 'meta', 'google', 'whatsapp', 'qr')`),
]);
