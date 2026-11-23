// lib-purchasing's routes (ADR-001 §6): declarations only. Purchase orders, their approval and the PO limits (RAD-136);
// purchase bills' drafts (RAD-138), with posting, its approval and cancelling to come with goods receipts.
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import {
  addBill, addOrder, cancelOrder, changeBill, changeOrder, closeOrder, dropBill, dropOrder, getBillById, getOrderById, listBillsPage, listOrderLimits, listOrdersPage, orderApproval, placeOrder,
  setOrderLimit,
} from '@radcore/lib-purchasing';
import {
  cancelPurchaseOrder, closePurchaseOrder, createPurchaseBill, createPurchaseOrder, deletePurchaseBill, deletePurchaseOrder, getPurchaseBill,
  getPurchaseOrder, listPurchaseBills, listPurchaseOrderLimits, updatePurchaseBill,
  listPurchaseOrders, placePurchaseOrder, purchaseOrderApproval, setPurchaseOrderLimit, updatePurchaseOrder,
} from '@radcore/lib-purchasing/contract';

export default [
  defineRoute(listPurchaseOrders, listOrdersPage),
  defineRoute(getPurchaseOrder, getOrderById),
  defineRoute(createPurchaseOrder, addOrder),
  defineRoute(updatePurchaseOrder, changeOrder),
  defineRoute(deletePurchaseOrder, dropOrder),
  defineRoute(placePurchaseOrder, placeOrder),
  ...defineApproval(purchaseOrderApproval, orderApproval),
  defineRoute(closePurchaseOrder, closeOrder),
  defineRoute(cancelPurchaseOrder, cancelOrder),
  defineRoute(listPurchaseOrderLimits, listOrderLimits),
  defineRoute(setPurchaseOrderLimit, setOrderLimit),
  defineRoute(listPurchaseBills, listBillsPage),
  defineRoute(getPurchaseBill, getBillById),
  defineRoute(createPurchaseBill, addBill),
  defineRoute(updatePurchaseBill, changeBill),
  defineRoute(deletePurchaseBill, dropBill),
];
