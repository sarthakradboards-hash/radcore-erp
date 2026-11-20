// lib-sales's entry (ADR-001 §2): its services, for the api's route file and for the libraries that sell.
export { discountAllowed, discountLimitFor, listLimits, setLimit } from './services/discounts.ts';
export { getChanges, listRatesPage } from './services/price-list-views.ts';
export {
  addList, askApproval, changeList, getList, getVersion, listListsPage, priceFor, priceListApproval, priceOf, putRates, setTax,
  startDraft,
} from './services/price-lists.ts';
export {
  addOrder, cancelOrderNow, changeOrder, closeOrderNow, confirmOrderNow, dropOrder, getOrderById, listOrdersPage, ORDER_SERIES,
} from './services/orders.ts';
export {
  acceptQuoteNow, addQuote, changeQuote, closeQuoteNow, dropQuote, getQuoteById, listQuotesPage, QUOTE_SERIES, sendQuoteNow,
} from './services/quotes.ts';
