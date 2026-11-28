// lib-sales's entry (ADR-001 §2): its services, for the api's route file and for the libraries that sell.
export {
  checkSale, overrideApproval, type OverrideVersion, type SaleCheck, type SaleCheckResult, type SaleLine, type SaleStage,
} from './services/checks.ts';
export { discountAllowed, discountLimitFor, listLimits, setLimit } from './services/discounts.ts';
export { DEFAULT_PRICE_LIST, getPartyList, salePrice, setPartyList } from './services/party-price-lists.ts';
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
export { deliveryReturnCounts, orderCounts, quoteCounts } from './services/document-counts.ts';
export {
  addDelivery, askDeliveryOverride, changeDelivery, DELIVERY_SERIES, dropDelivery, getDeliveryById, listDeliveriesPage, listToInvoicePage,
  postDeliveryNow,
} from './services/deliveries.ts';
export { deliveryOverride } from './services/delivery-checks.ts';
export { addInvoice, changeInvoice, getInvoiceById, listInvoicesPage } from './services/invoices.ts';
export { amendInvoiceNow } from './services/invoice-amendments.ts';
export { cancelInvoiceNow } from './services/invoice-cancel.ts';
export { remindWithLink } from './services/reminder-links.ts';
// The printouts' templates (RAD-120), each mounted with lib-platform's definePrintRoute.
export { challanPrint } from './print/challan.ts';
export { invoicePrint } from './print/invoice.ts';
export { quotePrint } from './print/quote.ts';
export { receiptPrint } from './print/receipt.ts';
export { DOCUMENT_LINK_DAYS, invoiceByLink, invoiceLinks, revokeInvoiceLinkNow, shareInvoiceLink } from './services/invoice-links.ts';
export { addCreditNote, listCreditNotesPage } from './services/credit-notes.ts';
export {
  askCreditNoteApproval, cancelCreditNoteNow, CREDIT_NOTE_SERIES, CREDIT_NOTE_TAX_DEADLINE, creditNoteApprovalSpec, dropCreditNote, getCreditNoteById,
} from './services/credit-note-post.ts';
export { cancelDeliveryNow, cancelDeliveryReturnNow } from './services/delivery-cancel.ts';
export {
  askInvoiceOverride, B2C_DETAILS_BASIS, B2C_DETAILS_LIMIT, dropInvoice, INVOICE_LAG_DAYS, INVOICE_SERIES, invoiceOverride, postInvoiceNow,
} from './services/invoice-post.ts';
export {
  addDeliveryReturn, changeDeliveryReturn, DELIVERY_RETURN_SERIES, dropDeliveryReturn, getDeliveryReturnById, listDeliveryReturnsPage,
  postDeliveryReturnNow,
} from './services/delivery-returns.ts';
export {
  acceptQuoteNow, addQuote, changeQuote, closeQuoteNow, dropQuote, getQuoteById, listQuotesPage, QUOTE_SERIES, sendQuoteNow,
} from './services/quotes.ts';
export {
  addAdvance, addBooking, BOOKING_SERIES, cancelBookingNow, getBookingById, listBookingsPage, refundBookingNow, saveChecklist,
} from './services/bookings.ts';
export { listTestRidesPage, recordRide, scheduleRide } from './services/test-rides.ts';
export { CARD_ACCOUNT, completeBillNow, holdBillNow, previewBill, quickBill } from './services/quick-bills.ts';
export { heldBillsPage } from './services/held-bills.ts';

// This library's settings and number series, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { Series, SettingDef } from '@radcore/lib-platform';
import { CREDIT_NOTE_SERIES, CREDIT_NOTE_TAX_DEADLINE } from './services/credit-note-post.ts';
import { DELIVERY_RETURN_SERIES as returned } from './services/delivery-returns.ts';
import { DELIVERY_SERIES as delivered } from './services/deliveries.ts';
import { defaultDiscountLimit } from './services/discounts.ts';
import { DOCUMENT_LINK_DAYS } from './services/invoice-links.ts';
import { B2C_DETAILS_BASIS, B2C_DETAILS_LIMIT, INVOICE_LAG_DAYS, INVOICE_SERIES } from './services/invoice-post.ts';
import { ORDER_SERIES as ordered } from './services/orders.ts';
import { DEFAULT_PRICE_LIST } from './services/party-price-lists.ts';
import { QUOTE_SERIES as quoted } from './services/quotes.ts';
import { BOOKING_SERIES as booked } from './services/bookings.ts';
import { CARD_ACCOUNT } from './services/quick-bills.ts';
export const settings: readonly SettingDef<unknown>[] = [defaultDiscountLimit, DEFAULT_PRICE_LIST, INVOICE_LAG_DAYS, B2C_DETAILS_LIMIT, B2C_DETAILS_BASIS,
  CREDIT_NOTE_TAX_DEADLINE, DOCUMENT_LINK_DAYS, CARD_ACCOUNT];
export const series: readonly Series[] = [quoted, ordered, delivered, returned, INVOICE_SERIES, CREDIT_NOTE_SERIES, booked];
