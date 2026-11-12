// lib-platform's own routes (ADR-001 §6): declarations only.
import {
  defineRoute, exportDownload, exportStatus, listAuditedTablesList, listAuditTrailPage, listSecurityEventsPage,
} from '@radcore/lib-platform';
import {
  downloadExport, getExport, listAuditedTables, listAuditTrail, listSecurityEvents,
} from '@radcore/lib-platform/contract';

export default [
  defineRoute(listAuditTrail, listAuditTrailPage),
  defineRoute(listAuditedTables, listAuditedTablesList),
  defineRoute(listSecurityEvents, listSecurityEventsPage),
  defineRoute(getExport, exportStatus),
  defineRoute(downloadExport, exportDownload),
];
