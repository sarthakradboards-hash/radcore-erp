// lib-platform's own routes (ADR-001 §6): declarations only.
import { defineRoute, listSecurityEventsPage } from '@radcore/lib-platform';
import { listSecurityEvents } from '@radcore/lib-platform/contract';

export default [defineRoute(listSecurityEvents, listSecurityEventsPage)];
