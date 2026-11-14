// Location kinds as screens show them (RAD-92): the fixed LOCATION_KINDS with each label from its setting. Renaming
// writes one setting; putting the default back removes it. Labels come from ctx.settings, read once per request.
import { LOCATION_KIND_CODES, LOCATION_KINDS } from '@radcore/lib-common';
import { AppError, saveSetting, type Ctx } from '@radcore/lib-platform';
import type { z } from 'zod';
import type { listLocationKinds, setLocationKindLabel } from '../contract.ts';
import { KIND_LABELS } from '../location-kinds.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** GET /stock/location-kinds (locations:read). */
export async function listKinds(ctx: Ctx): Promise<Out<typeof listLocationKinds>> {
  return { kinds: LOCATION_KIND_CODES.map((kind) =>
    ({ kind, label: ctx.settings.get(KIND_LABELS[kind]), sellable: LOCATION_KINDS[kind].sellable })) };
}

/** PUT /stock/location-kinds/:kind (locations:write). The label it would show, renamed or the default put back, must
 * be no other kind's. shortcut: checked against the labels this request read, so two admins renaming two kinds to one
 * label at the same moment could both pass; lock the label settings if renames ever become frequent. */
export async function setKindLabel(ctx: Ctx, input: In<typeof setLocationKindLabel>): Promise<Out<typeof setLocationKindLabel>> {
  const shown = input.label ?? LOCATION_KINDS[input.kind].label;
  if (LOCATION_KIND_CODES.some((k) => k !== input.kind && same(ctx.settings.get(KIND_LABELS[k]), shown))) {
    throw new AppError('label_in_use', 'Another kind already shows this name',
      [{ path: ['label'], code: 'taken', message: 'Choose another name' }]);
  }
  await saveSetting(ctx, KIND_LABELS[input.kind], input.label);
  return {};
}
