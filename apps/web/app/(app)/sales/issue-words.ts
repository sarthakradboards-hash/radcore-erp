// What an override's check codes say (RAD-125's approvals, RAD-124's quick bill): the screen's words for each, and for a code the server
// adds later the code as it is sent, never a missing string.
import { t } from '../../../lib/i18n/index.ts';

const ISSUES = ['over_limit', 'overdue', 'below_cost', 'cost_unknown', 'no_list_rate', 'over_discount'] as const;

export const issueWords = (code: string): string =>
  (ISSUES as readonly string[]).includes(code) ? t(`sales.approvals.issue.${code as (typeof ISSUES)[number]}`) : code;
