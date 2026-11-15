// Writing a setting (M1-30, RAD-92): a library changes one of its own settings through this, since only lib-platform
// may write the settings table (D7). One row per setting, so two people changing two settings at once never overwrite
// each other. The table's audit trigger keeps the old and new values (ADR-005 §7c).
import { platformTx, settings } from '@radcore/db/platform';
import { eq } from 'drizzle-orm';
import type { Ctx } from './ctx.ts';
import { settingRow, type SettingDef } from './settings.ts';

/** Stores a setting's value, checked by its schema first; `null` removes the stored row, so its default comes back.
 * The new value is what the next request reads (ctx.settings is read once, when a request starts). */
export async function saveSetting<T>(ctx: Ctx, def: SettingDef<T>, value: T | null): Promise<void> {
  const tx = platformTx(ctx);
  if (value === null) {
    await tx.delete(settings).where(eq(settings.key, def.key));
    return;
  }
  const row = settingRow(def, value);
  await tx.insert(settings).values(row).onConflictDoUpdate({ target: settings.key, set: { value: row.value } });
}
