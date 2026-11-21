// lib-crm's jobs (ADR-001 §8): declarations only. The morning's due follow-ups (RAD-109), and each outside door's
// enquiry (RAD-107). Meta's lead fetch is M7's: until then its job keeps each notification waiting (no fetch).
import {
  followUpsDueWatch, formEnquiry, formEnquiryJob, googleLead, googleLeadJob, metaLeadJob, metaLeadWaiting, tellFollowUpsDue, whatsappMessage,
  whatsappMessageJob,
} from '@radcore/lib-crm';
import { defineJob, defineWebhookJob } from '@radcore/lib-platform';

export default [defineJob(followUpsDueWatch, tellFollowUpsDue), defineWebhookJob(formEnquiryJob, formEnquiry),
  defineWebhookJob(googleLeadJob, googleLead), defineWebhookJob(metaLeadJob, metaLeadWaiting),
  defineWebhookJob(whatsappMessageJob, whatsappMessage)];
