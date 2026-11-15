// A location kind's display label, one setting each (RAD-92, the architect's design): `stock.location_kind_label_<kind>`,
// defaulting to LOCATION_KINDS' label. The settings table holds only a label an admin renamed, and a kind added in code
// later gets its default with no migration. A label never reaches a rule or the database: the code does.
import { LOCATION_KIND_CODES, LOCATION_KINDS, locationKindLabel, type LocationKind } from '@radcore/lib-common';
import { defineSetting, type SettingDef } from '@radcore/lib-platform';

/** Each kind's label setting. */
export const KIND_LABELS: Readonly<Record<LocationKind, SettingDef<string>>> = Object.freeze(Object.fromEntries(
  LOCATION_KIND_CODES.map((k) => [k, defineSetting(`stock.location_kind_label_${k}`, locationKindLabel(), LOCATION_KINDS[k].label)]),
) as Record<LocationKind, SettingDef<string>>);
