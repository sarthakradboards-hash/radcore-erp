// lib-crm's jobs (ADR-001 §8): declarations only. The morning's due follow-ups (RAD-109).
import { followUpsDueWatch, tellFollowUpsDue } from '@radcore/lib-crm';
import { defineJob } from '@radcore/lib-platform';

export default [defineJob(followUpsDueWatch, tellFollowUpsDue)];
