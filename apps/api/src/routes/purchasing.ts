// lib-purchasing's routes (ADR-001 §6): declarations only. Purchase orders, their approval and the PO limits (RAD-136).
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import {
  addOrder, cancelOrder, changeOrder, closeOrder, dropOrder, getOrderById, listOrderLimits, listOrdersPage, orderApproval, placeOrder,
  setOrderLimit,
} from '@radcore/lib-purchasing';
import {
  cancelPurchaseOrder, closePurchaseOrder, createPurchaseOrder, deletePurchaseOrder, getPurchaseOrder, listPurchaseOrderLimits,
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
];
