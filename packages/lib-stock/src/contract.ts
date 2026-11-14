// The stock module's contracts (ADR-001 §6, §7a). Like every contract file it imports only zod and lib-common (D5), so
// the browser can load it. RAD-92 (M2-14): the places stock can be. A location is switched off, never deleted
// (ADR-005 §3, D-12). Its kind is one of lib-common's fixed LOCATION_KINDS, whose labels are the screen's to word.
import { defineContract, idString, listInput, listOf, LOCATION_KIND_CODES, searchText } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

const locationKind = z.enum(LOCATION_KIND_CODES);
/** A short code people type and print: letters, digits and `-`, kept as typed, unique whatever its case. */
const locationCode = () => z.string().trim().min(1, 'Enter a code').max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use letters, digits and -');
const locationName = () => z.string().trim().min(1, 'Enter a name').max(120);
const status = z.enum(['active', 'inactive']);

const location = z.object({ id: idString(), code: z.string(), name: z.string(), kind: locationKind, active: z.boolean() });

/** Locations a page at a time, by code: searched by code or name, filtered by kind and by active or switched off. */
export const listLocations = defineContract({
  method: 'GET', path: '/stock/locations', auth: 'session', perm: 'locations:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), kind: locationKind.optional(), status: status.optional() })),
  output: listOf(location),
});

/** A new location. code_taken: another has this code, whatever its case or spacing. */
export const addLocation = defineContract({
  method: 'POST', path: '/stock/locations', auth: 'session', perm: 'locations:write', tx: write,
  input: z.object({ code: locationCode(), name: locationName(), kind: locationKind }), output: z.object({ id: idString() }),
  errors: ['code_taken'],
});

/** A location renamed, recoded, moved to another kind, or switched off or on. */
export const updateLocation = defineContract({
  method: 'PATCH', path: '/stock/locations/:id', auth: 'session', perm: 'locations:write', tx: write,
  input: z.object({ id: idString(), code: locationCode().optional(), name: locationName().optional(),
    kind: locationKind.optional(), active: z.boolean().optional() }),
  output: z.object({}), errors: ['code_taken'],
});
