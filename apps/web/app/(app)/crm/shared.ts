// What the CRM screens share (RAD-122): the refusals in the screen's words, and how a lead's owner and name read.
// The server holds every rule (scope, claiming, stages, plans); the screens draw what it sends and word what it refuses.
import { LEAD_STAGES } from '@radcore/lib-crm/contract';
import { t } from '../../../lib/i18n/index.ts';

export type Stage = (typeof LEAD_STAGES)[number];

const CODES = ['unknown_source', 'lead_taken', 'unknown_reason', 'wrong_stage', 'unknown_plan', 'unknown_reply', 'unknown_person',
  'owner_cannot_see_leads', 'forbidden', 'name_taken', 'source_not_ignorable', 'campaign_ended', 'unknown_campaign'] as const;
/** The CRM contracts' refusals in the screen's words, for Form's `messages`. */
export const CRM_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`crm.err.${c}`)]));

/** For an action on one lead: there a not_found means the lead left this person's sight, almost always because
 * someone else claimed it first (e2e-2 on #334), so it says so rather than a bare "Not found". */
export const LEAD_MESSAGES: Partial<Record<string, string>> = { ...CRM_MESSAGES, not_found: t('crm.err.lead_gone') };

/** The step a lead's shown follow-up belongs to. The server's planStep is the step the follow-up after it takes
 * (pipeline.ts), so the shown one is the plan's step just before it, read from the plan's own steps (e2e-2 on #334). */
export function shownStep(steps: readonly { step: number }[], planStep: number | null): number | null {
  if (planStep === null) return null;
  const at = steps.findIndex((s) => s.step === planStep);
  return at > 0 ? steps[at - 1]!.step : null;
}

export const stageName = (s: Stage) => t(`crm.stage.${s}`);

/**
 * Whose a lead is, as far as the screen can say: the server sends the owner as a principal (`user:<id>`) without a
 * name, so another person's lead reads "Someone else".
 * shortcut: no owner names until listLeads and getLead send them (asked of backend-2 on RAD-122); then show the name.
 */
export function ownerText(owner: string | null, meId: string): string {
  if (owner === null) return t('crm.owner.nobody');
  return owner === `user:${meId}` ? t('crm.owner.you') : t('crm.owner.other');
}

/** A lead's name, or, while it has none, the last digits its masked phone keeps. */
export function leadName(name: string | null, phone: { masked: string } | string): string {
  if (name !== null) return name;
  const end = (typeof phone === 'string' ? phone : phone.masked).replace(/^•+/, '').slice(-4);
  return end === '' ? t('crm.lead.noName') : t('crm.lead.unnamed', { end });
}
