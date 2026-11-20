// lib-sales's routes (ADR-001 §6): declarations only. Price lists, their approval and discount limits (RAD-98); quotes and
// orders (RAD-112).
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import {
  addList, askApproval, changeList, getChanges, getList, getVersion, listLimits, listListsPage, listRatesPage, priceListApproval,
  priceOf, putRates, setLimit, setTax, startDraft, acceptQuoteNow, addOrder, addQuote, cancelOrderNow, changeOrder, changeQuote,
  closeOrderNow, closeQuoteNow, confirmOrderNow, dropOrder, dropQuote, getOrderById, getQuoteById, listOrdersPage, listQuotesPage,
  sendQuoteNow,
} from '@radcore/lib-sales';
import {
  createPriceList, getPrice, getPriceList, getPriceListChanges, getPriceListVersion, listDiscountLimits, listPriceListRates, listPriceLists, priceListApproval as
  priceListApprovalContracts, putPriceListRates, requestPriceListApproval, setDiscountLimit, setPriceListTax, startPriceListDraft,
  updatePriceList, acceptQuote, cancelOrder, closeOrder, closeQuote, confirmOrder, createOrder, createQuote, deleteOrder, deleteQuote,
  getOrder, getQuote, listOrders, listQuotes, sendQuote, updateOrder, updateQuote,
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
  defineRoute(listQuotes, listQuotesPage),
  defineRoute(getQuote, getQuoteById),
  defineRoute(createQuote, addQuote),
  defineRoute(updateQuote, changeQuote),
  defineRoute(deleteQuote, dropQuote),
  defineRoute(sendQuote, sendQuoteNow),
  defineRoute(acceptQuote, acceptQuoteNow),
  defineRoute(closeQuote, closeQuoteNow),
  defineRoute(listOrders, listOrdersPage),
  defineRoute(getOrder, getOrderById),
  defineRoute(createOrder, addOrder),
  defineRoute(updateOrder, changeOrder),
  defineRoute(deleteOrder, dropOrder),
  defineRoute(confirmOrder, confirmOrderNow),
  defineRoute(closeOrder, closeOrderNow),
  defineRoute(cancelOrder, cancelOrderNow),
];
