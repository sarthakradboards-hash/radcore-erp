// Test rides and a delivered booking's checklist (M3-13, RAD-117; RC-208; the architect's rulings), re-exported by
// ../contract.ts. Like every contract file it imports only zod, lib-common and other libraries' contract entries (D5).
import { defineContract, idString, listInput, listOf, momentString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** How a ride went: liked it, not interested, wants another model, didn't turn up, or called off before it happened. */
export const TEST_RIDE_OUTCOMES = ['liked', 'not_interested', 'wants_another', 'no_show', 'cancelled'] as const;
const outcome = z.enum(TEST_RIDE_OUTCOMES);
const note = () => z.string().trim().min(1).max(2000);

const ride = z.object({ id: idString(), leadId: idString(), itemId: idString(), serialNo: z.string(), scheduledAt: momentString(),
  doneAt: momentString().nullable(), outcome: outcome.nullable(), note: z.string().nullable() });

/** Test rides, soonest first, a page at a time: a lead's, or a unit's, and the principal's own at `own` scope. */
export const listTestRides = defineContract({
  method: 'GET', path: '/sales/test-rides', auth: 'session', perm: 'bookings:read', tx: read,
  input: listInput(z.object({ leadId: idString().optional(), itemId: idString().optional(), serialNo: z.string().max(60).optional() })),
  output: listOf(ride),
});

/** Schedules a ride for a lead the person may open (else not_found) on a demo unit of ours (`not_demo`). Rides are
 * records, not locks: several may share a unit and a time. */
export const scheduleTestRide = defineContract({
  method: 'POST', path: '/sales/test-rides', auth: 'session', perm: 'bookings:write', tx: write,
  input: z.object({ leadId: idString(), itemId: idString(), serialNo: z.string().trim().min(1).max(60), scheduledAt: momentString(),
    note: note().optional() }),
  output: z.object({ id: idString() }), errors: ['not_demo'],
});

/** Records how a ride went, once: its outcome is required once it's done (`wrong_status` if it's recorded already).
 * Before its time it can only be `cancelled` (`wrong_status` otherwise). */
export const recordTestRide = defineContract({
  method: 'POST', path: '/sales/test-rides/:id/outcome', auth: 'session', perm: 'bookings:write', tx: write,
  input: z.object({ id: idString(), outcome, note: note().optional() }), output: z.object({}), errors: ['wrong_status'],
});

/**
 * A delivered booking's checklist (RC-208): the inspection, the rider's briefing, the warranty registered, and a photo
 * and a signed note, each a ready upload of its own kind (`wrong_file_kind` otherwise, `not_ready` while it's checked).
 * Saved whole, as often as needed. The invoice never waits for it; `complete` says whether it's done.
 */
export const saveBookingChecklist = defineContract({
  method: 'PUT', path: '/sales/bookings/:id/checklist', auth: 'session', perm: 'bookings:write', tx: write,
  input: z.object({ id: idString(), inspected: z.boolean(), briefed: z.boolean(), warrantyRegistered: z.boolean(),
    photoId: idString().nullable(), noteId: idString().nullable() }),
  output: z.object({ complete: z.boolean() }), errors: ['wrong_status', 'wrong_file_kind', 'not_ready', 'upload_refused'],
});
