// lib-crm's tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, money, radcoreTable } from '../columns.ts';

// The CRM's own lists, which leads:setup keeps up (M3-05, RAD-109; the architect: a list people keep up isn't a
// setting, ADR-001 §8c). A lead names an item by id, so one in use is switched off, never deleted. Each name's key
// folds case and runs of spaces, so `Price` and ` price ` can't both exist.

/** Why a lead was lost. */
export const leadLostReasons = radcoreTable('lead_lost_reasons', {
  id: id(),
  label: boundedText({ max: 80 }).notNull(),
  active: boolean().notNull().default(true),
  labelKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(label, '[[:space:]]+', ' ', 'g')))`),
}, (t) => [uniqueIndex('ux_lead_lost_reasons_label_key').on(t.labelKey)]);

/** A follow-up plan: its steps are follow_up_plan_steps. */
export const followUpPlans = radcoreTable('follow_up_plans', {
  id: id(),
  name: boundedText({ max: 60 }).notNull(),
  active: boolean().notNull().default(true),
  nameKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))`),
}, (t) => [uniqueIndex('ux_follow_up_plans_name_key').on(t.nameKey)]);

/** A plan's steps, 1 up: each falls `afterDays` after the follow-up before it, the first after the day a lead is put on
 * the plan. `note` says what the step is for. */
export const followUpPlanSteps = radcoreTable('follow_up_plan_steps', {
  planId: uuid().notNull().references(() => followUpPlans.id),
  step: smallint().notNull(),
  afterDays: smallint().notNull(),
  note: boundedText({ max: 200 }),
}, (t) => [
  primaryKey({ columns: [t.planId, t.step] }),
  check('ck_follow_up_plan_steps_step', sql`${t.step} between 1 and 20`),
  check('ck_follow_up_plan_steps_after_days', sql`${t.afterDays} between 1 and 365`),
]);

/** A quick reply: plain text the screen opens in WhatsApp. Its placeholders are M3-06's. */
export const quickReplies = radcoreTable('quick_replies', {
  id: id(),
  title: boundedText({ max: 60 }).notNull(),
  body: boundedText({ max: 1000 }).notNull(),
  active: boolean().notNull().default(true),
  titleKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(title, '[[:space:]]+', ' ', 'g')))`),
}, (t) => [uniqueIndex('ux_quick_replies_title_key').on(t.titleKey)]);

/**
 * A lead (M3-02, RAD-106): one per phone number, in E.164, so a repeat enquiry joins the lead it repeats (RC-142). The
 * unique index is the lock on the number: two enquiries from one number at once wait for each other there, and the
 * second joins the first's lead. The owner is named as audit rows name a principal (`user:<id>`), null while no one
 * owns it (E7's own scope). Notes are staff's own words; what an outsider wrote is in lead_enquiries (RC-173).
 * Its place in the pipeline (M3-05, RAD-109): a stage, a lost reason only while lost, a deal value and a 0 to 100
 * score that staff set, and a follow-up plan with the step its next follow-up takes. `followUpToldOn` is the follow-up
 * date its owner was last told of, so they're told once.
 */
export const leads = radcoreTable('leads', {
  id: id(),
  phone: text().notNull(),
  name: boundedText({ max: 120 }),
  email: boundedText({ max: 254 }),
  owner: text(),
  followUpOn: date({ mode: 'string' }),
  /** Its latest enquiry's time: a repeat moves it, which locks the lead's row while the enquiry is saved. */
  lastEnquiryAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  notes: boundedText({ max: 2000 }),
  stage: text().notNull().default('new'),
  lostReasonId: uuid().references(() => leadLostReasons.id, { onDelete: 'restrict' }),
  value: money(),
  score: smallint(),
  planId: uuid().references(() => followUpPlans.id, { onDelete: 'restrict' }),
  planStep: smallint(),
  followUpToldOn: date({ mode: 'string' }),
}, (t) => [
  uniqueIndex('ux_leads_phone').on(t.phone),
  index('ix_leads_owner_follow_up').on(t.owner, t.followUpOn),
  index('ix_leads_lost_reason').on(t.lostReasonId),
  index('ix_leads_plan').on(t.planId),
  check('ck_leads_phone', sql`${t.phone} ~ '^[+][1-9][0-9]{6,14}$'`),
  check('ck_leads_owner', sql`${t.owner} ~ '^user:[0-9a-f-]{36}$'`),
  check('ck_leads_stage', sql`${t.stage} in ('new', 'contacted', 'interested', 'meeting_booked', 'converted', 'lost')`),
  check('ck_leads_lost_with_reason', sql`(${t.stage} = 'lost') = (${t.lostReasonId} is not null)`),
  check('ck_leads_score', sql`${t.score} between 0 and 100`),
  check('ck_leads_plan_whole', sql`(${t.planId} is null) = (${t.planStep} is null)`),
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

/**
 * What staff did on a lead, for its page's timeline (M3-05): a follow-up made, a quick reply sent, or a stage moved
 * to (`stage`). `note` is staff's own words, or the quick reply's title. Written once and never changed; the lead's
 * other changes are in the audit trail.
 */
export const leadActivities = radcoreTable('lead_activities', {
  id: id(),
  leadId: uuid().notNull().references(() => leads.id),
  kind: text().notNull(),
  stage: text(),
  note: boundedText({ max: 2000 }),
}, (t) => [
  index('ix_lead_activities_lead').on(t.leadId, t.createdAt),
  check('ck_lead_activities_kind', sql`${t.kind} in ('follow_up', 'quick_reply', 'stage')`),
  check('ck_lead_activities_stage', sql`(${t.kind} = 'stage') = (${t.stage} is not null)`),
]);
