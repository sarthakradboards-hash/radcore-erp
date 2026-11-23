// The crm module's library (ADR-001 §5): its services, which apps/api's routes/crm.ts mounts.
export {
  createEnquiryForm, formEnquiry, formEnquiryJob, googleLead, googleLeadJob, metaLead, metaLeadJob, metaLeadWaiting, takeFormEnquiry, turnstileBefore, whatsappMessage, type Turnstile,
  whatsappMessageJob,
} from './services/doors.ts';
export {
  addLostReason, addPlan, addQuickReply, changeLostReason, changePlan, changeQuickReply, leadLists,
} from './services/lead-lists.ts';
export {
  assignLeadOwner, followUpDone, followUpDue, followUpsDueWatch, leadHolders, listLeadsPage, moveLeadStage, putOnPlan, quickReplyText,
  tellFollowUpsDue, updateLeadDetails,
} from './services/pipeline.ts';
export { captureEnquiry, leadById, repeatEnquiry, type Capture } from './services/leads.ts';
export { addLeadSource, changeLeadSource, leadSourcesList, setAsidePage } from './services/sources.ts';
export { addAdSpend, addCampaign, adSpendPage, campaignPath, campaignsPage, costPerLeadIn, endCampaignNow } from './services/campaigns.ts';
export { bookingCancelled, bookingMade, leadNames, leadOpens } from './services/lead-bookings.ts';
export { holdLead } from './services/lead-locks.ts';
