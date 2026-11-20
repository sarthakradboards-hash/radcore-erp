// The crm module's routes (RAD-106): declarations only. Lead capture by hand or at the counter, and one lead.
import { defineRoute } from '@radcore/lib-platform';
import { captureEnquiry, leadById } from '@radcore/lib-crm';
import { captureLead, getLead } from '@radcore/lib-crm/contract';

export default [
  defineRoute(captureLead, captureEnquiry),
  defineRoute(getLead, leadById),
];
