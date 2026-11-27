// gst.credit_from (ADR-009 §2, CA-04): the supplier kinds whose bills carry input credit. Strict until the CA answers
// (D-08): regular suppliers only. Each choice widens the last, since an unregistered supplier can't be ahead of a
// composition dealer; a choice, so the settings screen edits it as it is.
import { defineSetting, type Ctx } from '@radcore/lib-platform';
import { z } from 'zod';
import type { SupplierKind } from '../rules/credit.ts';

const CHOICES = ['regular', 'regular,composition', 'regular,composition,unregistered'] as const;

export const CREDIT_FROM = defineSetting('gst.credit_from', z.enum(CHOICES), 'regular', {
  label: 'Input credit from',
  description: 'The suppliers whose bills carry input GST credit. Any other supplier’s GST is part of the cost. The CA confirms this (CA-04).',
  input: { kind: 'choice', choices: [
    { value: 'regular', label: 'Regular registered suppliers only' },
    { value: 'regular,composition', label: 'Regular and composition suppliers' },
    { value: 'regular,composition,unregistered', label: 'Every supplier, registered or not' },
  ] },
});

export const creditFrom = (ctx: Ctx): readonly SupplierKind[] => ctx.settings.get(CREDIT_FROM).split(',') as SupplierKind[];
