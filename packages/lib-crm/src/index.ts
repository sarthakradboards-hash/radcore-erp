// The crm module's library (ADR-001 §5): its services, which apps/api's routes/crm.ts mounts.
export { captureEnquiry, leadById, repeatEnquiry, type Capture } from './services/leads.ts';
