// lib-stock's entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  addCategory, addItem, addItemPicture, batchNumbers, changeItem, checkQuantity, dropItemPicture, getItemById, itemFlags, itemLabels, listCategories,
  listItemsPage, purchasePrices, listUnits, renameCategory,
} from './services/items.ts';
export { quantityFits } from './rules/quantity.ts';
export { onHand, quantitiesAt, sellableOnHand } from './services/on-hand.ts';
export { revaluesOf } from './services/revalues.ts';
export { SELL_DAMAGED_UNITS } from './engine/units.ts';
export { checkBooks } from './services/books-check.ts';
export { averageCost } from './services/cost.ts';
export { listKinds, setKindLabel } from './services/location-kinds.ts';
export { addPlace, checkPlace, listPlaces, updatePlace } from './services/locations.ts';
export { placeNames } from './services/moves-lines.ts';
export { stockSheets } from './sheets.ts';
export {
  postUnitEvents, releasePromises, serialKey, soldCondition, soldUnits, unitFor, unitOwners, type InUnitEvent, type MoveUnitEvent, type OutUnitEvent,
  type UnitChange, type UnitOnLine,
} from './engine/units.ts';
export {
  addTransfer, askTransferApproval, cancelTransferNow, dropTransfer, FRANCHISEE_TRANSFER_APPROVAL, getTransferById, listTransfersPage, requalifyTransfer,
  TRANSFER_SERIES,
  transferApprovalSpec,
} from './services/transfers.ts';
export {
  addCount, askCountApproval, cancelCountNow, changeCount, COUNT_SERIES, countApprovalSpec, dropCount, getCountById, listCountsPage,
} from './services/counts.ts';
export {
  addAdjustment, ADJUSTMENT_SERIES, adjustmentApprovalSpec, askAdjustmentApproval, cancelAdjustmentNow, changeAdjustment, dropAdjustment,
  getAdjustmentById, listAdjustmentsPage,
} from './services/adjustments.ts';
export { NEGATIVE_STOCK, batchKey, holdStock, postStock, reverseStock, type BatchIn, type BatchOut, type PostedMovement, type StockIn, type StockOut, type StockPosting, type StockRevalue, type StockTransfer } from './engine/stock.ts';

// This library's settings and number series, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { Series, SettingDef } from '@radcore/lib-platform';
import { NEGATIVE_STOCK as negative } from './engine/stock.ts';
import { SELL_DAMAGED_UNITS as sellDamaged } from './engine/units.ts';
import { KIND_LABELS } from './location-kinds.ts';
import { ADJUSTMENT_SERIES as adjusted } from './services/adjustments.ts';
import { COUNT_SERIES as counted } from './services/counts.ts';
import { FRANCHISEE_TRANSFER_APPROVAL as franchisee, TRANSFER_SERIES as moved } from './services/transfers.ts';
export const settings: readonly SettingDef<unknown>[] = [negative, sellDamaged, franchisee, ...Object.values(KIND_LABELS)];
export const series: readonly Series[] = [moved, counted, adjusted];
