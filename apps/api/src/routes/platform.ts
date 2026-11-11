// lib-platform's own routes (ADR-001 §6): declarations only.
import { defineRoute, listAuditedTablesList, listAuditTrailPage, listSecurityEventsPage } from '@radcore/lib-platform';
import { listAuditedTables, listAuditTrail, listSecurityEvents } from '@radcore/lib-platform/contract';

export default [
  defineRoute(listAuditTrail, listAuditTrailPage),
  defineRoute(listAuditedTables, listAuditedTablesList),
  defineRoute(listSecurityEvents, listSecurityEventsPage),
];
