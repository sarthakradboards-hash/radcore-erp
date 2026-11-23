// The crm module's routes (RAD-106, RAD-109, RAD-110): declarations only. Lead capture by hand or at the counter, one
// lead, the pipeline, and CRM setup: lead sources and what they set aside, campaigns, ad spend and cost per lead.
import { defineRoute } from '@radcore/lib-platform';
import {
  addLostReason, addPlan, addQuickReply, assignLeadOwner, captureEnquiry, leadHolders, changeLostReason, changePlan, changeQuickReply, followUpDone,
  leadById, leadLists, listLeadsPage, moveLeadStage, putOnPlan, quickReplyText, updateLeadDetails,
  addAdSpend, addCampaign, addLeadSource, adSpendPage, campaignsPage, changeLeadSource, costPerLeadIn, endCampaignNow, leadSourcesList,
  setAsidePage,
} from '@radcore/lib-crm';
import {
  assignLead, captureLead, createLostReason, createPlan, createQuickReply, followUpLead, getLead, getLeadLists, listLeadHolders, listLeads, moveLead,
  planLead, quickReply, updateLead, updateLostReason, updatePlan, updateQuickReply,
  costPerLead, createCampaign, createLeadSource, endCampaign, listAdSpend, listCampaigns, listLeadSources, listSetAside, recordAdSpend,
  updateLeadSource,
} from '@radcore/lib-crm/contract';

export default [
  defineRoute(captureLead, captureEnquiry),
  defineRoute(getLead, leadById),
  defineRoute(listLeads, listLeadsPage),
  defineRoute(listLeadHolders, leadHolders),
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
  defineRoute(listLeadSources, leadSourcesList),
  defineRoute(createLeadSource, addLeadSource),
  defineRoute(updateLeadSource, changeLeadSource),
  defineRoute(listSetAside, setAsidePage),
  defineRoute(listCampaigns, campaignsPage),
  defineRoute(createCampaign, addCampaign),
  defineRoute(endCampaign, endCampaignNow),
  defineRoute(listAdSpend, adSpendPage),
  defineRoute(recordAdSpend, addAdSpend),
  defineRoute(costPerLead, costPerLeadIn),
];
