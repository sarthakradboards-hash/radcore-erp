// lib-stock's routes (ADR-001 §6): declarations only. Items, their categories and units of measure (RAD-89), and
// locations and their kinds' labels (RAD-92).
import { defineRoute } from '@radcore/lib-platform';
import {
  addCategory, addItem, addPlace, changeItem, getItemById, listCategories, listItemsPage, listKinds, listPlaces, listUnits,
  renameCategory, setKindLabel, updatePlace,
} from '@radcore/lib-stock';
import {
  addLocation, createItem, createItemCategory, getItem, listItemCategories, listItems, listLocationKinds, listLocations,
  listUnitsOfMeasure, renameItemCategory, setLocationKindLabel, updateItem, updateLocation,
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
  defineRoute(listLocationKinds, listKinds),
  defineRoute(setLocationKindLabel, setKindLabel),
  defineRoute(listLocations, listPlaces),
  defineRoute(addLocation, addPlace),
  defineRoute(updateLocation, updatePlace),
];
