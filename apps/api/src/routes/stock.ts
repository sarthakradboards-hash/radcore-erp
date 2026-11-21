// lib-stock's routes (ADR-001 §6): declarations only. Items, their categories and units of measure (RAD-89), and
// locations and their kinds' labels (RAD-92), the books check (RAD-95), and stock on hand (RAD-112).
import { defineRoute } from '@radcore/lib-platform';
import {
  addCategory, addItem, addItemPicture, addPlace, changeItem, checkBooks, dropItemPicture, getItemById, listCategories, listItemsPage,
  listKinds, listPlaces, listUnits, onHand, renameCategory, setKindLabel, updatePlace,
} from '@radcore/lib-stock';
import {
  addLocation, attachItemPicture, checkBooksContract, createItem, createItemCategory, getItem, getOnHand, listItemCategories, listItems, listLocationKinds,
  listLocations, listUnitsOfMeasure, removeItemPicture, renameItemCategory, setLocationKindLabel, updateItem, updateLocation,
} from '@radcore/lib-stock/contract';

export default [
  defineRoute(checkBooksContract, checkBooks),
  defineRoute(listUnitsOfMeasure, listUnits),
  defineRoute(listItemCategories, listCategories),
  defineRoute(createItemCategory, addCategory),
  defineRoute(renameItemCategory, renameCategory),
  defineRoute(listItems, listItemsPage),
  defineRoute(getItem, getItemById),
  defineRoute(createItem, addItem),
  defineRoute(updateItem, changeItem),
  defineRoute(attachItemPicture, addItemPicture),
  defineRoute(removeItemPicture, dropItemPicture),
  defineRoute(listLocationKinds, listKinds),
  defineRoute(setLocationKindLabel, setKindLabel),
  defineRoute(listLocations, listPlaces),
  defineRoute(addLocation, addPlace),
  defineRoute(updateLocation, updatePlace),
  defineRoute(getOnHand, onHand),
];
