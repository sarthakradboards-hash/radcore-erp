'use client';
// Every field has a visible <label> tied to its control, and its hint and error are read with it (M1-43, from M1-41).
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { isMasked } from '@radcore/lib-common';
import { useFormContext, type FieldError } from 'react-hook-form';
import { Pii } from '../masked.tsx';
import { useFieldName } from './form.tsx';

type Common = { name: string; label: string; hint?: ReactNode };

function useField(name: string) {
  useFieldName(name);
  const { register, getFieldState, formState } = useFormContext();
  const id = useId();
  const error: FieldError | undefined = getFieldState(name, formState).error;
  return { id, error, control: register(name) };
}

function Frame({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: FieldError | undefined; children: ReactNode }) {
  return (
    <div className="kit-field">
      <label htmlFor={id}>{label}</label>
      {hint !== undefined && <p id={`${id}-hint`} className="kit-field-hint">{hint}</p>}
      {children}
      {error?.message !== undefined && <p id={`${id}-error`} className="kit-field-error">{error.message}</p>}
    </div>
  );
}

const described = (id: string, hint: unknown, error: FieldError | undefined) =>
  [hint !== undefined && `${id}-hint`, error?.message !== undefined && `${id}-error`].filter(Boolean).join(' ') || undefined;

type Native<T> = Omit<T, 'name' | 'id' | 'children' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'>;

/** A one-line field. Amounts and quantities stay strings: use inputMode="decimal", never type="number" (ADR-001 §7a). */
export function TextField({ name, label, hint, ...native }: Common & Native<InputHTMLAttributes<HTMLInputElement>>) {
  const { id, error, control } = useField(name);
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <input id={id} {...native} {...control} aria-invalid={error !== undefined} aria-describedby={described(id, hint, error)} />
    </Frame>
  );
}

export function TextAreaField({ name, label, hint, ...native }: Common & Native<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  const { id, error, control } = useField(name);
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <textarea id={id} rows={3} {...native} {...control} aria-invalid={error !== undefined} aria-describedby={described(id, hint, error)} />
    </Frame>
  );
}

/** One choice from a short, fixed list, as radio buttons: picking one only fills the form, which acts on Submit
 * (RC-148). A long or searched list uses the Picker instead. `disabled` options are the server's (a role you may
 * not grant), shown so the person sees why. */
export function RadioField({ name, label, hint, options }: Common & {
  options: readonly { value: string; label: string; detail?: ReactNode; disabled?: boolean }[];
}) {
  const { id, error, control } = useField(name);
  return (
    <fieldset className="kit-field kit-radios" aria-describedby={described(id, hint, error)}
      aria-invalid={error !== undefined}>
      <legend>{label}</legend>
      {hint !== undefined && <p id={`${id}-hint`} className="kit-field-hint">{hint}</p>}
      {options.map((o) => (
        <label key={o.value} className="kit-radio">
          <input type="radio" value={o.value} disabled={o.disabled} {...control} />
          <span>{o.label}{o.detail === undefined ? null : <span className="kit-field-hint">{o.detail}</span>}</span>
        </label>
      ))}
      {error?.message !== undefined && <p id={`${id}-error`} className="kit-field-error">{error.message}</p>}
    </fieldset>
  );
}

/** A value shown read-only and never sent back: a pii() value, which the server may have masked for this person
 * (`{ masked }` on the wire, RAD-40). The form leaves it out before checking and submitting, and edit contracts leave
 * out-of-body fields alone (§7a). It's text, not an input, so a screen reader never voices the bullets: it hears
 * "Hidden" or "Hidden, ends 3210" (Pii). A value this person may see shows as it is (the auditor on #164). */
export function MaskedField({ name, label, hint }: Common) {
  useFieldName(name, 'masked');
  const id = useId();
  const value: unknown = useFormContext().getValues(name);
  return (
    <div className="kit-field" role="group" aria-labelledby={`${id}-label`}
      {...(hint === undefined ? {} : { 'aria-describedby': `${id}-hint` })}>
      <span id={`${id}-label`} className="kit-field-label">{label}</span>
      {hint !== undefined && <p id={`${id}-hint`} className="kit-field-hint">{hint}</p>}
      <p className="kit-field-value"><Pii value={isMasked(value) || typeof value === 'string' ? value : ''} /></p>
    </div>
  );
}
