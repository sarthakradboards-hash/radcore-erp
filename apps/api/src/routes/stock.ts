// lib-stock's routes (ADR-001 §6): declarations only. Items, their categories and units of measure (RAD-89), and
// locations (RAD-92).
import { defineRoute } from '@radcore/lib-platform';
import {
  addCategory, addItem, addPlace, changeItem, getItemById, listCategories, listItemsPage, listPlaces, listUnits, renameCategory,
  updatePlace,
} from '@radcore/lib-stock';
import {
  addLocation, createItem, createItemCategory, getItem, listItemCategories, listItems, listLocations, listUnitsOfMeasure,
  renameItemCategory, updateItem, updateLocation,
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
  defineRoute(listLocations, listPlaces),
  defineRoute(addLocation, addPlace),
  defineRoute(updateLocation, updatePlace),
];
