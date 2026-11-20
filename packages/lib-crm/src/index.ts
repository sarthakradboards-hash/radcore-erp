// The crm module's library (ADR-001 §5): its services, which apps/api's routes/crm.ts mounts.
export {
  addLostReason, addPlan, addQuickReply, changeLostReason, changePlan, changeQuickReply, leadLists,
} from './services/lead-lists.ts';
export {
  assignLeadOwner, followUpDone, followUpDue, followUpsDueWatch, listLeadsPage, moveLeadStage, putOnPlan, quickReplyText,
  tellFollowUpsDue, updateLeadDetails,
} from './services/pipeline.ts';
export { captureEnquiry, leadById, repeatEnquiry, type Capture } from './services/leads.ts';
