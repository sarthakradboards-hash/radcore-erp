'use client';
// Every field has a visible <label> tied to its control, and its hint and error are read with it (M1-43, from M1-41).
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useFormContext, type FieldError } from 'react-hook-form';
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

/** A value the server masked for this person (a phone number, bank details). Shown read-only and never sent back:
 * the form leaves it out before checking and submitting, and edit contracts leave out-of-body fields alone (§7a). */
export function MaskedField({ name, label, hint }: Common) {
  useFieldName(name, 'masked');
  const id = useId();
  const value: unknown = useFormContext().getValues(name);
  return (
    <Frame id={id} label={label} hint={hint}>
      {/* No name and not registered, so it is no part of what the form sends. */}
      <input id={id} readOnly value={typeof value === 'string' ? value : ''} aria-describedby={described(id, hint, undefined)} />
    </Frame>
  );
}
