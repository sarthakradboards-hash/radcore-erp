// lib-sales's entry (ADR-001 §2): its services, for the api's route file and for the libraries that sell.
export { discountAllowed, discountLimitFor, listLimits, setLimit } from './services/discounts.ts';
export {
  addList, askApproval, changeList, getVersion, listListsPage, listRatesPage, priceFor, priceListApproval, priceOf, putRates,
  setTax, startDraft,
} from './services/price-lists.ts';
