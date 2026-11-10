'use client';
// The one form (M1-43, RC-187): React Hook Form, checked with the contract's own zod schema, so the form and the API
// refuse the same things (RC-186). A refused save puts each issue of the error envelope on its field (ADR-001 §7a).
// The Idempotency-Key belongs to the caller's mutation (ui's useApiMutation), which keeps it across retries.
import { zodResolver } from '@hookform/resolvers/zod';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { FormProvider, useForm, useFormContext, type DefaultValues, type FieldValues } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError } from '../../../lib/api-client.ts';
import { announce } from '../live-region.tsx';
import { omitFields, placeIssues } from './issues.ts';
import './form.css';

type Names = { mounted: Set<string>; masked: Set<string> };
const NamesContext = createContext<Names | null>(null);

/** Tells the form a field is on screen (so a server issue for it lands there) or masked (so it is never sent). */
export function useFieldName(name: string, kind: keyof Names = 'mounted') {
  const names = useContext(NamesContext);
  if (names === null) throw new Error(`The field "${name}" must be inside a <Form>`);
  useEffect(() => {
    names[kind].add(name);
    return () => { names[kind].delete(name); };
  }, [names, kind, name]);
}

const OFFLINE = 'RadCore could not be reached. Check the connection, then try again.';

type FormProps<I extends FieldValues, O extends FieldValues> = {
  /** The contract's input schema, or a part of it (`contract.input.pick(...)`). */
  schema: z.ZodType<O, I>;
  defaultValues: DefaultValues<I>;
  /** Sends the save. Throwing an ApiError puts its issues on the fields. */
  onSubmit: (values: O) => Promise<unknown>;
  /** Said to screen readers once the save succeeds, or false to say nothing. */
  saved?: string | false;
  /** The form's accessible name, usually the id of its heading. */
  'aria-labelledby'?: string;
  children: ReactNode;
};

export function Form<I extends FieldValues, O extends FieldValues>(
  { schema, defaultValues, onSubmit, saved = 'Saved', children, ...aria }: FormProps<I, O>,
) {
  const [names] = useState<Names>(() => ({ mounted: new Set(), masked: new Set() }));
  const check = zodResolver(schema);
  const form = useForm<I, unknown, O>({
    defaultValues,
    // Masked fields are left out before the check, so they are neither validated nor sent.
    resolver: (values, context, options) => check(omitFields(values, names.masked), context, options),
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (e) {
      if (!(e instanceof ApiError)) {
        form.setError('root.server', { type: 'offline', message: OFFLINE });
        return;
      }
      const { fields, rest } = placeIssues(e.envelope.issues, names.mounted);
      fields.forEach(({ name, message }, i) =>
        form.setError(name as never, { type: 'server', message }, { shouldFocus: i === 0 }));
      const message = rest.length === 0 ? e.envelope.message : `${e.envelope.message}: ${rest.join('; ')}`;
      form.setError('root.server', { type: e.code, message });
      return;
    }
    if (saved !== false) announce(saved);
  });

  return (
    <FormProvider {...form}>
      <NamesContext.Provider value={names}>
        <form className="kit-form" noValidate onSubmit={(event) => void submit(event)} {...aria}>
          <FormAlert />
          {children}
        </form>
      </NamesContext.Provider>
    </FormProvider>
  );
}

/** The form-level problem: what the server said, and any issue no field on screen can show. */
function FormAlert() {
  const { formState: { errors } } = useFormContext();
  const message = errors.root?.['server']?.message;
  // Always in the page, so screen readers announce the text when it appears.
  return <p role="alert" className="kit-form-alert">{message}</p>;
}

/** The submit button. Disabled while the save is in flight, so a second press can't send it twice. */
export function SubmitButton({ children }: { children: ReactNode }) {
  const { formState: { isSubmitting } } = useFormContext();
  return (
    <button type="submit" className="kit-button kit-button-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
      {children}
    </button>
  );
}
