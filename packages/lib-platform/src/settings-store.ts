// Writing a setting (M1-30, RAD-92): a library changes one of its own settings through this, since only lib-platform
// may write the settings table (D7). One row per setting, so two people changing two settings at once never overwrite
// each other. The table's audit trigger keeps the old and new values (ADR-005 §7c).
import { platformTx, settings } from '@radcore/db/platform';
import { eq } from 'drizzle-orm';
import type { Ctx } from './ctx.ts';
import { settingRow, type StoredSetting } from './settings.ts';

/**
 * Stores a module's setting, checked by its schema first; `null` removes the stored row, so its default comes back.
 * The new value is what the next request reads (ctx.settings is read once, when a request starts). A `platform.*`
 * setting is refused: lib-platform exports some of its own (linkMaxDays), and a module's service mustn't change them
 * (auditor-2 on #181). lib-platform writes its own with its own writer, when one first needs one.
 */
export async function saveSetting<T>(ctx: Ctx, def: StoredSetting<T>, value: T | null): Promise<void> {
  if (def.key.startsWith('platform.')) throw new TypeError(`${def.key} is lib-platform's: a module can't change it`);
  await storeSetting(ctx, def.key, value === null ? null : settingRow(def, value).value);
}

/** Writes a value already checked, or removes the row for null. lib-platform's own: saveSetting for a module's
 * setting, and the settings screen's PUT /settings/:key (RAD-132), which checks against the composed catalogue. */
export async function storeSetting(ctx: Ctx, key: string, value: unknown): Promise<void> {
  const tx = platformTx(ctx);
  if (value === null) {
    await tx.delete(settings).where(eq(settings.key, key));
    return;
  }
  await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}
