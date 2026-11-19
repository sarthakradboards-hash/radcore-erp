// lib-stock's entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  addCategory, addItem, addItemPicture, changeItem, checkQuantity, dropItemPicture, getItemById, itemLabels, listCategories, listItemsPage,
  listUnits, renameCategory,
} from './services/items.ts';
export { quantityFits } from './rules/quantity.ts';
export { listKinds, setKindLabel } from './services/location-kinds.ts';
export { addPlace, listPlaces, updatePlace } from './services/locations.ts';
export { stockSheets } from './sheets.ts';
export {
  postUnitEvents, serialKey, type InUnitEvent, type MoveUnitEvent, type OutUnitEvent, type UnitChange, type UnitOnLine,
} from './engine/units.ts';
export { NEGATIVE_STOCK, batchKey, postStock, type BatchIn, type BatchOut, type PostedMovement, type StockIn, type StockOut, type StockPosting, type StockTransfer } from './engine/stock.ts';
