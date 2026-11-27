// What the overseas tick does to a party's tax boxes (RAD-169 on RAD-153, ADR-010 §4). Ticking clears what an overseas
// supplier can't have and sets state 96, keeping what was there; unticking puts it back, so a registered supplier's
// GSTIN, PAN and state are never lost by a tick and untick (e2e-playwright's NIT 1 on #445).

/** GST's code for a place outside India: an overseas supplier's state. */
export const OTHER_COUNTRY = '96';

export type TaxBoxes = { gstin: unknown; pan: unknown; composition: unknown; stateCode: unknown };

/** The boxes to set, and what to keep for an untick. With nothing kept (a saved overseas party unticked), the state is
 * left to be chosen. */
export function overseasChange(ticked: boolean, now: TaxBoxes, kept: TaxBoxes | null): { set: TaxBoxes; kept: TaxBoxes | null } {
  if (ticked) {
    const { gstin, pan, composition, stateCode } = now;
    return { set: { gstin: '', pan: '', composition: false, stateCode: OTHER_COUNTRY }, kept: { gstin, pan, composition, stateCode } };
  }
  return { set: kept ?? { gstin: now.gstin, pan: now.pan, composition: now.composition, stateCode: '' }, kept: null };
}
