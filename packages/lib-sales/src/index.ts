// lib-sales's entry (ADR-001 §2): its services, for the api's route file and for the libraries that sell.
export {
  checkSale, overrideApproval, type OverrideVersion, type SaleCheck, type SaleCheckResult, type SaleLine, type SaleStage,
} from './services/checks.ts';
export { discountAllowed, discountLimitFor, listLimits, setLimit } from './services/discounts.ts';
export { getChanges, listRatesPage } from './services/price-list-views.ts';
export {
  addList, askApproval, changeList, getList, getVersion, listListsPage, priceFor, priceListApproval, priceOf, putRates, setTax,
  startDraft,
} from './services/price-lists.ts';
export {
  addOrder, askOrderOverride, cancelOrderNow, changeOrder, closeOrderNow, confirmOrderNow, dropOrder, getOrderById, listOrdersPage,
  ORDER_SERIES,
} from './services/orders.ts';
export { orderOverride } from './services/order-checks.ts';
export {
  addDelivery, askDeliveryOverride, changeDelivery, DELIVERY_SERIES, dropDelivery, getDeliveryById, listDeliveriesPage, listToInvoicePage,
  postDeliveryNow,
} from './services/deliveries.ts';
export { deliveryOverride } from './services/delivery-checks.ts';
export { addInvoice, changeInvoice, dropInvoice, getInvoiceById, listInvoicesPage } from './services/invoices.ts';
export {
  askInvoiceOverride, B2C_DETAILS_BASIS, B2C_DETAILS_LIMIT, INVOICE_LAG_DAYS, INVOICE_SERIES, invoiceOverride, postInvoiceNow,
} from './services/invoice-post.ts';
export {
  addDeliveryReturn, changeDeliveryReturn, DELIVERY_RETURN_SERIES, dropDeliveryReturn, getDeliveryReturnById, listDeliveryReturnsPage,
  postDeliveryReturnNow,
} from './services/delivery-returns.ts';
export {
  acceptQuoteNow, addQuote, changeQuote, closeQuoteNow, dropQuote, getQuoteById, listQuotesPage, QUOTE_SERIES, sendQuoteNow,
} from './services/quotes.ts';
