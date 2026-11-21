// lib-stock's entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  addCategory, addItem, addItemPicture, changeItem, checkQuantity, dropItemPicture, getItemById, itemLabels, listCategories, listItemsPage, purchasePrices,
  listUnits, renameCategory,
} from './services/items.ts';
export { quantityFits } from './rules/quantity.ts';
export { onHand } from './services/on-hand.ts';
export { SELL_DAMAGED_UNITS } from './engine/units.ts';
export { checkBooks } from './services/books-check.ts';
export { averageCost } from './services/cost.ts';
export { listKinds, setKindLabel } from './services/location-kinds.ts';
export { addPlace, checkPlace, listPlaces, updatePlace } from './services/locations.ts';
export { stockSheets } from './sheets.ts';
export {
  postUnitEvents, releasePromises, serialKey, unitFor, type InUnitEvent, type MoveUnitEvent, type OutUnitEvent, type UnitChange, type UnitOnLine,
} from './engine/units.ts';
export { NEGATIVE_STOCK, batchKey, postStock, reverseStock, type BatchIn, type BatchOut, type PostedMovement, type StockIn, type StockOut, type StockPosting, type StockTransfer } from './engine/stock.ts';

// This library's settings and number series, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { Series, SettingDef } from '@radcore/lib-platform';
import { NEGATIVE_STOCK as negative } from './engine/stock.ts';
import { SELL_DAMAGED_UNITS as sellDamaged } from './engine/units.ts';
import { KIND_LABELS } from './location-kinds.ts';
export const settings: readonly SettingDef<unknown>[] = [negative, sellDamaged, ...Object.values(KIND_LABELS)];
export const series: readonly Series[] = [];
