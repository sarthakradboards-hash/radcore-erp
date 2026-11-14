// lib-platform's routes (ADR-001 §6): your own session and sessions, the admin's sessions (RAD-34), asking for a
// password reset (RAD-32), which only queues its email, the audit trail and security events (RAD-30, RAD-31), and an
// export's status and download (RAD-47), and roles and the permission matrix (RAD-36), custom roles included (RAD-83).
// Sign-in and the password routes need Argon2id and the lockout store, so they're built at start (createAuth's routes).
import {
  changeUserRole, createCustomRole, defineRoute, deleteCustomRole, endAnySession, endCurrentSession, endOwnSession, endPersonSessions, getMyself, listAllSessions,
  exportDownload, exportStatus, listAuditedTablesList, listAuditTrailPage, listOwnSessions, listSecurityEventsPage,
  listRolesFor, permissionMatrix, renameRole, requestPasswordReset, resetRoleToTemplate, setRoleGrants,
} from '@radcore/lib-platform';
import * as contract from '@radcore/lib-platform/contract';

export default [
  defineRoute(contract.signOut, endCurrentSession),
  defineRoute(contract.getMe, getMyself),
  defineRoute(contract.listMySessions, listOwnSessions),
  defineRoute(contract.endMySession, endOwnSession),
  defineRoute(contract.listSessions, listAllSessions),
  defineRoute(contract.endSession, endAnySession),
  defineRoute(contract.endUserSessions, endPersonSessions),
  defineRoute(contract.requestPasswordReset, requestPasswordReset),
  defineRoute(contract.listAuditTrail, listAuditTrailPage),
  defineRoute(contract.listAuditedTables, listAuditedTablesList),
  defineRoute(contract.listSecurityEvents, listSecurityEventsPage),
  defineRoute(contract.getExport, exportStatus),
  defineRoute(contract.downloadExport, exportDownload),
  defineRoute(contract.listRoles, listRolesFor),
  defineRoute(contract.getPermissionMatrix, permissionMatrix),
  defineRoute(contract.setRolePermissions, setRoleGrants),
  defineRoute(contract.setUserRole, changeUserRole),
  defineRoute(contract.createRole, createCustomRole),
  defineRoute(contract.updateRole, renameRole),
  defineRoute(contract.deleteRole, deleteCustomRole),
  defineRoute(contract.resetRole, resetRoleToTemplate),
];
