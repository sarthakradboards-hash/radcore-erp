// lib-stock's routes (ADR-001 §6): declarations only. Items, their categories and units of measure (RAD-89), and
// locations (RAD-92).
import { defineRoute } from '@radcore/lib-platform';
import {
  addCategory, addItem, addItemPicture, addPlace, changeItem, dropItemPicture, getItemById, listCategories, listItemsPage,
  listPlaces, listUnits, renameCategory, updatePlace,
} from '@radcore/lib-stock';
import {
  addLocation, attachItemPicture, createItem, createItemCategory, getItem, listItemCategories, listItems, listLocations,
  listUnitsOfMeasure, removeItemPicture, renameItemCategory, updateItem, updateLocation,
} from '@radcore/lib-stock/contract';

export default [
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
  defineRoute(listLocations, listPlaces),
  defineRoute(addLocation, addPlace),
  defineRoute(updateLocation, updatePlace),
];
