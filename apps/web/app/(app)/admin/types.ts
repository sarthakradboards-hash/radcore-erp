// The admin screens' row types, read off lib-platform's contracts (RAD-57, #105).
import type {
  getPermissionMatrix, listAuditTrail, listRoles, listSecurityEvents, listSessions, listUsers,
} from '@radcore/lib-platform/contract';
import type { listGstRates } from '@radcore/lib-gst/contract';
import type {
  listItemCategories, listItems, listLocationKinds, listLocations, listUnitsOfMeasure,
} from '@radcore/lib-stock/contract';
import type { z } from 'zod';

type Items<C extends { output: z.ZodType }> = z.output<C['output']> extends { items: (infer T)[] } ? T : never;

export type AdminUser = Items<typeof listUsers>;
export type UserStatus = AdminUser['status'];
export type Role = z.output<typeof listRoles.output>['roles'][number];
export type Matrix = z.output<typeof getPermissionMatrix.output>;
export type AdminSession = Items<typeof listSessions>;
export type AuditRow = Items<typeof listAuditTrail>;
export type AuditOp = AuditRow['op'];
export type SecurityEvent = Items<typeof listSecurityEvents>;
export type SecurityEventKind = SecurityEvent['kind'];
export type StockLocation = Items<typeof listLocations>;
export type LocationKindInfo = z.output<typeof listLocationKinds.output>['kinds'][number];
export type StockItem = Items<typeof listItems>;
export type ItemCategory = z.output<typeof listItemCategories.output>['categories'][number];
export type ItemUnit = z.output<typeof listUnitsOfMeasure.output>['units'][number];
export type GstRate = Items<typeof listGstRates>;
