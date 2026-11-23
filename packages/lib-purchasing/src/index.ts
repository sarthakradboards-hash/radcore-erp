// lib-purchasing's entry (ADR-001 §2): its services, for the api's route file.
export {
  addOrder, cancelOrder, changeOrder, closeOrder, dropOrder, getOrderById, listOrdersPage, ORDER_SERIES, orderApproval, placeOrder,
} from './services/orders.ts';
export { listOrderLimits, ORDER_LIMIT_DEFAULT, orderLimitOf, setOrderLimit } from './services/order-limits.ts';
export {
  addReceipt, cancelReceiptNow, changeReceipt, dropReceipt, getReceiptById, listReceiptsPage, postReceipt, RECEIPT_SERIES, receiptLinesFor,
} from './services/receipts.ts';
export { purchaseOrderPrint } from './print/order.ts';
export {
  addReturn, cancelReturnNow, changeReturn, dropReturn, getReturnById, listReturnsPage, postReturn, RETURN_SERIES,
} from './services/returns.ts';
export { supplierReturnPrint } from './print/return.ts';
export { addBill, BILL_SERIES, BILL_TOLERANCE, changeBill, dropBill, getBillById, listBillsPage, overPoRate } from './services/bills.ts';

// This library's settings and number series, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { Series, SettingDef } from '@radcore/lib-platform';
import { BILL_SERIES, BILL_TOLERANCE } from './services/bills.ts';
import { ORDER_LIMIT_DEFAULT } from './services/order-limits.ts';
import { ORDER_SERIES } from './services/orders.ts';
import { RECEIPT_SERIES as received } from './services/receipts.ts';
import { RETURN_SERIES as returned } from './services/returns.ts';
export const settings: readonly SettingDef<unknown>[] = [ORDER_LIMIT_DEFAULT, BILL_TOLERANCE];
export const series: readonly Series[] = [ORDER_SERIES, received, BILL_SERIES, returned];
