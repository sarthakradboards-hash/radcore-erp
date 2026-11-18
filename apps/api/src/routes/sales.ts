// lib-sales's routes (ADR-001 §6): declarations only. Price lists, their approval and discount limits (RAD-98).
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import {
  addList, askApproval, changeList, getChanges, getList, getVersion, listLimits, listListsPage, listRatesPage, priceListApproval,
  priceOf, putRates, setLimit, setTax, startDraft,
} from '@radcore/lib-sales';
import {
  createPriceList, getPrice, getPriceList, getPriceListChanges, getPriceListVersion, listDiscountLimits, listPriceListRates, listPriceLists, priceListApproval as
  priceListApprovalContracts, putPriceListRates, requestPriceListApproval, setDiscountLimit, setPriceListTax, startPriceListDraft,
  updatePriceList,
} from '@radcore/lib-sales/contract';

export default [
  defineRoute(listPriceLists, listListsPage),
  defineRoute(getPriceList, getList),
  defineRoute(createPriceList, addList),
  defineRoute(updatePriceList, changeList),
  defineRoute(startPriceListDraft, startDraft),
  defineRoute(getPriceListVersion, getVersion),
  defineRoute(listPriceListRates, listRatesPage),
  defineRoute(getPriceListChanges, getChanges),
  defineRoute(setPriceListTax, setTax),
  defineRoute(putPriceListRates, putRates),
  defineRoute(requestPriceListApproval, askApproval),
  ...defineApproval(priceListApprovalContracts, priceListApproval),
  defineRoute(getPrice, priceOf),
  defineRoute(listDiscountLimits, listLimits),
  defineRoute(setDiscountLimit, setLimit),
];
