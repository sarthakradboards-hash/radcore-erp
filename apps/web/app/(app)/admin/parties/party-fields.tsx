'use client';
// A party's fields (RAD-99 on RAD-90's contracts), shared by "New party" and the party's own page, on createParty's
// schema. The changes are only about the boxes: an empty optional box is the contract's null. The rules between the
// tax fields are the contract's own partyTaxIssues, so the form shows them on the right field before sending.
// Contact fields the server masked for this person (no parties:contact) show read-only and are never sent (RAD-40).
import { GST_STATES, isMasked } from '@radcore/lib-common';
import { createParty, PARTY_KINDS, partyTaxIssues } from '@radcore/lib-accounts/contract';
import { useFormContext } from 'react-hook-form';
import { z } from 'zod';
import {
  CheckboxField, CheckboxesField, MaskedField, SelectField, TextField,
} from '../../../../components/ui/form/fields.tsx';
import { t } from '../../../../lib/i18n/index.ts';

const shape = createParty.input.shape;
/** A box the person may leave empty: empty is the contract's null. */
const optional = <S extends z.ZodType<unknown, string | null>>(schema: S) => z.string().trim().transform((s) => (s === '' ? null : s)).pipe(schema);
const fields = {
  ...shape,
  gstin: optional(shape.gstin), pan: optional(shape.pan), phone: optional(shape.phone), email: optional(shape.email),
  addressLine1: optional(shape.addressLine1), addressLine2: optional(shape.addressLine2), city: optional(shape.city),
  pincode: optional(shape.pincode),
};
export const newPartySchema = z.object(fields).superRefine((p, c) => {
  for (const i of partyTaxIssues(p)) c.addIssue({ code: 'custom', path: i.path, message: i.message });
});
// An edit sends what changed; the server checks the tax rules on the party as it will be.
export const editPartySchema = z.object(fields).partial();

const STATES = Object.entries(GST_STATES).sort(([, a], [, b]) => a.localeCompare(b))
  .map(([code, name]) => ({ value: code, label: `${name} (${code})` }));
/** A party's kinds as words: "Customer, Supplier". */
export const kindsText = (kinds: readonly (typeof PARTY_KINDS)[number][]) =>
  kinds.map((k) => t(`admin.parties.kind.${k}`)).join(', ');
const kindOptions = () => PARTY_KINDS.map((k) => ({ value: k, label: t(`admin.parties.kind.${k}`) }));

/** A contact field: masked for this person, so read-only and never sent; or a box they may fill. */
function Contact({ name, label, ...native }: { name: string; label: string } & Parameters<typeof TextField>[0]) {
  const value: unknown = useFormContext().getValues(name);
  return isMasked(value) ? <MaskedField name={name} label={label} /> : <TextField name={name} label={label} {...native} />;
}

export function PartyFields() {
  return (
    <>
      <TextField name="name" label={t('admin.parties.name')} autoComplete="off" />
      <CheckboxesField name="kinds" label={t('admin.parties.kinds')} options={kindOptions()} />
      <TextField name="gstin" label={t('admin.parties.gstin')} hint={t('admin.parties.gstin.hint')} autoComplete="off" spellCheck={false} />
      <TextField name="pan" label={t('admin.parties.pan')} hint={t('admin.parties.pan.hint')} autoComplete="off" spellCheck={false} />
      <SelectField name="stateCode" label={t('admin.parties.state')} placeholder={t('admin.parties.state.choose')} options={STATES} />
      <CheckboxField name="composition" label={t('admin.parties.composition')} hint={t('admin.parties.composition.hint')} />
      <Contact name="phone" label={t('admin.parties.phone')} type="tel" autoComplete="off" />
      <Contact name="email" label={t('admin.parties.email')} type="email" autoComplete="off" />
      <Contact name="addressLine1" label={t('admin.parties.address1')} autoComplete="off" />
      <Contact name="addressLine2" label={t('admin.parties.address2')} autoComplete="off" />
      <Contact name="city" label={t('admin.parties.city')} autoComplete="off" />
      <Contact name="pincode" label={t('admin.parties.pincode')} inputMode="numeric" autoComplete="off" />
    </>
  );
}
