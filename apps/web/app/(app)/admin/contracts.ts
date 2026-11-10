// The admin routes' contracts as ui-2 asked for them on RAD-32, RAD-34, RAD-36 and RAD-30 (10 Nov).
// shortcut: declared here until backend declares them in lib-platform's contract.ts; then the screens import those
// and this file is deleted. Keep it to the posted shapes, so the swap is only an import change.
import {
  dateRange, defineContract, emailString, idString, listInput, listOf, momentString, searchText,
} from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const roleKey = () => z.string().regex(/^[a-z][a-z_]{1,31}$/);
const reason = () => z.string().trim().min(1, 'Say why, in your own words').max(500);
const userStatus = z.enum(['invited', 'active', 'disabled']);
export type UserStatus = z.infer<typeof userStatus>;

export const listUsers = defineContract({
  method: 'GET', path: '/admin/users', auth: 'session', perm: 'users:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), status: userStatus.optional(), role: roleKey().optional() })),
  output: listOf(z.object({
    id: idString(), displayName: z.string(), email: z.string(), status: userStatus, role: roleKey(),
    lastSignInAt: momentString().nullable(), secondFactor: z.enum(['not_required', 'enrolled', 'not_enrolled']),
    self: z.boolean(),
  })),
});
export type AdminUser = z.infer<typeof listUsers.output>['items'][number];

export const inviteUser = defineContract({
  method: 'POST', path: '/admin/users', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ email: emailString(), displayName: z.string().trim().min(1, 'Enter a name').max(120), role: roleKey() }),
  output: z.object({ id: idString() }), errors: ['email_taken', 'role_not_grantable'],
});

export const resendInvite = defineContract({
  method: 'POST', path: '/admin/users/:id/invite', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['not_invited'],
});

export const setUserRole = defineContract({
  method: 'PUT', path: '/admin/users/:id/role', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString(), role: roleKey(), reason: reason() }),
  output: z.object({ sessionsEnded: z.number().int().nonnegative() }),
  errors: ['own_account', 'role_not_grantable', 'last_admin'],
});

export const deactivateUser = defineContract({
  method: 'POST', path: '/admin/users/:id/deactivate', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }),
  output: z.object({ sessionsEnded: z.number().int().nonnegative() }),
  errors: ['own_account', 'last_admin', 'already_disabled'],
});

export const reactivateUser = defineContract({
  method: 'POST', path: '/admin/users/:id/reactivate', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }), output: z.object({ status: userStatus }), errors: ['not_disabled'],
});

export const listRoles = defineContract({
  method: 'GET', path: '/admin/roles', auth: 'session', perm: 'roles:read', tx: read, input: z.object({}),
  output: z.object({ roles: z.array(z.object({
    key: roleKey(), name: z.string(), description: z.string(), userCount: z.number().int().nonnegative(),
    secondFactorRequired: z.boolean(), grantable: z.boolean(),
  })) }),
});
export type Role = z.infer<typeof listRoles.output>['roles'][number];

export const getPermissionMatrix = defineContract({
  method: 'GET', path: '/admin/permissions', auth: 'session', perm: 'roles:read', tx: read, input: z.object({}),
  output: z.object({
    version: z.string(),
    permissions: z.array(z.object({ key: z.string(), module: z.string(), label: z.string() })),
    roles: z.array(z.object({ key: roleKey(), name: z.string(), editable: z.boolean(), grants: z.array(z.string()) })),
  }),
});
export type Matrix = z.infer<typeof getPermissionMatrix.output>;

export const setRolePermissions = defineContract({
  method: 'PUT', path: '/admin/roles/:key/permissions', auth: 'session', perm: 'roles:write', tx: write,
  input: z.object({ key: roleKey(), grants: z.array(z.string()), version: z.string(), reason: reason() }),
  output: z.object({ version: z.string() }), errors: ['role_not_editable', 'matrix_changed', 'unknown_permission'],
});

export const listSessions = defineContract({
  method: 'GET', path: '/admin/sessions', auth: 'session', perm: 'users:read', tx: read,
  input: listInput(z.object({ userId: idString().optional() })),
  output: listOf(z.object({
    id: idString(), user: z.object({ id: idString(), displayName: z.string() }),
    createdAt: momentString(), lastSeenAt: momentString(), idleExpiresAt: momentString(), absoluteExpiresAt: momentString(),
    device: z.string().max(80), current: z.boolean(),
  })),
});
export type AdminSession = z.infer<typeof listSessions.output>['items'][number];

export const endSession = defineContract({
  method: 'DELETE', path: '/admin/sessions/:id', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['current_session'],
});

export const endUserSessions = defineContract({
  method: 'POST', path: '/admin/users/:id/sessions/end', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ ended: z.number().int().nonnegative() }), errors: ['own_account'],
});

const auditOp = z.enum(['insert', 'update', 'delete']);
export type AuditOp = z.infer<typeof auditOp>;

export const listAuditTrail = defineContract({
  method: 'GET', path: '/admin/audit', auth: 'session', perm: 'audit:read', tx: read,
  input: listInput(z.object({
    occurred: dateRange(),
    tableName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'Choose a table from the list').optional(),
    recordId: z.string().max(64).optional(),
    principal: z.string().max(80).optional(),
    op: auditOp.optional(),
  })),
  output: listOf(z.object({
    id: idString(), occurredAt: momentString(),
    principal: z.object({ kind: z.enum(['user', 'system', 'link']), id: z.string(), displayName: z.string().nullable() }),
    tableName: z.string(), recordId: z.string(), op: auditOp,
    changed: z.record(z.string(), z.object({ old: z.json().optional(), new: z.json().optional() })),
  })),
  errors: ['range_too_long'],
});
export type AuditRow = z.infer<typeof listAuditTrail.output>['items'][number];

export const listAuditedTables = defineContract({
  method: 'GET', path: '/admin/audit/tables', auth: 'session', perm: 'audit:read', tx: read,
  input: z.object({}), output: z.object({ tables: z.array(z.string()) }),
});
