// lib-stock's entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  addCategory, addItem, changeItem, checkQuantity, getItemById, listCategories, listItemsPage, listUnits, renameCategory,
} from './services/items.ts';
export { quantityFits } from './rules/quantity.ts';
export { listKinds, setKindLabel } from './services/location-kinds.ts';
export { addPlace, listPlaces, updatePlace } from './services/locations.ts';
export { batchKey, postStock, type BatchIn, type BatchOut, type PostedMovement, type StockIn, type StockOut, type StockPosting, type StockTransfer } from './engine/stock.ts';
