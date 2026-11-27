'use client';
// A party's fields (RAD-99 on RAD-90's contracts), shared by "New party" and the party's own page, on createParty's
// schema. The changes are only about the boxes: an empty optional box is the contract's null. The rules between the
// tax fields are the contract's own partyTaxIssues, so the form shows them on the right field before sending.
// Contact fields the server masked for this person (no parties:contact) show read-only and are never sent (RAD-40).
// An overseas supplier (RAD-169 on RAD-153, ADR-010 §4) has no GSTIN, PAN or composition and is in state 96: ticking it
// clears and hides those boxes and sets the state; the contract's own rules still say what's wrong, in place.
import { GST_STATES, isMasked, stateName } from '@radcore/lib-common';
import { createParty, PARTY_KINDS, partyTaxIssues } from '@radcore/lib-accounts/contract';
import { useEffect, useRef } from 'react';
import { useFormContext } from 'react-hook-form';
import { z } from 'zod';
import {
  CheckboxField, CheckboxesField, MaskedField, SelectField, TextField,
} from '../../../../components/ui/form/fields.tsx';
import { t } from '../../../../lib/i18n/index.ts';
import { MESSAGES } from '../shared.tsx';
import { OTHER_COUNTRY, overseasChange, type TaxBoxes } from './overseas.ts';

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

/** A party's state in words; 96, other country, is an overseas supplier's. */
export const partyStateName = (code: string) =>
  code === OTHER_COUNTRY ? t('admin.parties.state.96') : stateName(code) ?? code;
/** The admin words, but a refused party never names its tax boxes: for an overseas supplier they're hidden. */
export const PARTY_MESSAGES = { ...MESSAGES, invalid_input: t('admin.parties.err.invalid') };
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
  const { watch, setValue } = useFormContext();
  const kept = useRef<TaxBoxes | null>(null);
  const kinds = watch('kinds') as readonly string[] | undefined;
  const overseas = watch('overseas') === true;
  useEffect(() => {
    // Only the person's own tick acts: a saved overseas party loads as it is.
    const sub = watch((v, { name }) => {
      if (name !== 'overseas') return;
      const change = overseasChange(v['overseas'] === true,
        { gstin: v['gstin'], pan: v['pan'], composition: v['composition'], stateCode: v['stateCode'] }, kept.current);
      kept.current = change.kept;
      for (const [f, value] of Object.entries(change.set)) setValue(f, value);
    });
    return () => sub.unsubscribe();
  }, [watch, setValue]);
  return (
    <>
      <TextField name="name" label={t('admin.parties.name')} autoComplete="off" />
      <CheckboxesField name="kinds" label={t('admin.parties.kinds')} options={kindOptions()} />
      {/* Offered for a supplier; kept while ticked, so the "supplier only" refusal shows where it can be undone. */}
      {overseas || (kinds?.includes('supplier') ?? false)
        ? <CheckboxField name="overseas" label={t('admin.parties.overseas')} hint={t('admin.parties.overseas.hint')} /> : null}
      {overseas ? <p>{t('admin.parties.overseas.state')}</p> : (
        <>
          <TextField name="gstin" label={t('admin.parties.gstin')} hint={t('admin.parties.gstin.hint')} autoComplete="off" spellCheck={false} />
          <TextField name="pan" label={t('admin.parties.pan')} hint={t('admin.parties.pan.hint')} autoComplete="off" spellCheck={false} />
          <SelectField name="stateCode" label={t('admin.parties.state')} placeholder={t('admin.parties.state.choose')} options={STATES} />
          <CheckboxField name="composition" label={t('admin.parties.composition')} hint={t('admin.parties.composition.hint')} />
        </>
      )}
      <Contact name="phone" label={t('admin.parties.phone')} type="tel" autoComplete="off" />
      <Contact name="email" label={t('admin.parties.email')} type="email" autoComplete="off" />
      <Contact name="addressLine1" label={t('admin.parties.address1')} autoComplete="off" />
      <Contact name="addressLine2" label={t('admin.parties.address2')} autoComplete="off" />
      <Contact name="city" label={t('admin.parties.city')} autoComplete="off" />
      <Contact name="pincode" label={t('admin.parties.pincode')} inputMode="numeric" autoComplete="off" />
    </>
  );
}
