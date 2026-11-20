// The crm module's routes (RAD-106, RAD-109): declarations only. Lead capture by hand or at the counter, one lead, and
// the pipeline.
import { defineRoute } from '@radcore/lib-platform';
import {
  addLostReason, addPlan, addQuickReply, assignLeadOwner, captureEnquiry, changeLostReason, changePlan, changeQuickReply, followUpDone,
  leadById, leadLists, listLeadsPage, moveLeadStage, putOnPlan, quickReplyText, updateLeadDetails,
} from '@radcore/lib-crm';
import {
  assignLead, captureLead, createLostReason, createPlan, createQuickReply, followUpLead, getLead, getLeadLists, listLeads, moveLead,
  planLead, quickReply, updateLead, updateLostReason, updatePlan, updateQuickReply,
} from '@radcore/lib-crm/contract';

export default [
  defineRoute(captureLead, captureEnquiry),
  defineRoute(getLead, leadById),
  defineRoute(listLeads, listLeadsPage),
  defineRoute(getLeadLists, leadLists),
  defineRoute(createLostReason, addLostReason),
  defineRoute(updateLostReason, changeLostReason),
  defineRoute(createPlan, addPlan),
  defineRoute(updatePlan, changePlan),
  defineRoute(createQuickReply, addQuickReply),
  defineRoute(updateQuickReply, changeQuickReply),
  defineRoute(updateLead, updateLeadDetails),
  defineRoute(moveLead, moveLeadStage),
  defineRoute(followUpLead, followUpDone),
  defineRoute(planLead, putOnPlan),
  defineRoute(quickReply, quickReplyText),
  defineRoute(assignLead, assignLeadOwner),
];
