// lib-stock's routes (ADR-001 §6): declarations only. Items, their categories and units of measure (RAD-89).
import { defineRoute } from '@radcore/lib-platform';
import {
  addCategory, addItem, addItemPicture, changeItem, dropItemPicture, getItemById, listCategories, listItemsPage, listUnits, renameCategory,
} from '@radcore/lib-stock';
import {
  attachItemPicture, createItem, createItemCategory, getItem, listItemCategories, listItems, listUnitsOfMeasure, removeItemPicture,
  renameItemCategory, updateItem,
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
];
