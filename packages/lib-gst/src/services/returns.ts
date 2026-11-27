// GSTR-1's settings (M5-04, RAD-154; ADR-010 §3, §14): strict until the CA confirms them (D-08), so the settings screen
// edits them as they are.
import { moneyString, roundMoney } from '@radcore/lib-common';
import { defineSetting } from '@radcore/lib-platform';
import { z } from 'zod';

/** B2C large (Table 5): an inter-state invoice to a buyer with no GSTIN above this, invoice by invoice. 1,00,000 is the
 * limit from 1 August 2024; the CA confirms it before the first return. */
export const B2CL_LIMIT = defineSetting('gst.b2cl_limit', moneyString(), roundMoney('100000'), {
  label: 'B2C large invoice limit',
  description: 'GSTR-1 lists an inter-state invoice to a buyer with no GSTIN one by one (Table 5) when its value is above this. The CA confirms it.',
  input: { kind: 'money' },
});

/** Table 12's HSN summary, by the first this many digits of each HSN (CA-17). */
export const HSN_DIGITS = defineSetting('gst.hsn_digits', z.enum(['4', '6', '8']), '6', {
  label: 'HSN digits in GSTR-1',
  description: 'How many digits of each HSN GSTR-1’s HSN summary (Table 12) groups by. The CA confirms it (CA-17).',
  input: { kind: 'choice', choices: [{ value: '4', label: '4 digits' }, { value: '6', label: '6 digits' }, { value: '8', label: '8 digits' }] },
});
