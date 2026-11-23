// lib-purchasing's routes (ADR-001 §6): declarations only. Purchase orders, their approval and the PO limits (RAD-136);
// goods receipts (RAD-137).
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import {
  addOrder, addReceipt, cancelOrder, cancelReceiptNow, changeOrder, changeReceipt, closeOrder, dropOrder, dropReceipt, getOrderById,
  getReceiptById, listOrderLimits, listOrdersPage, listReceiptsPage, orderApproval, placeOrder, postReceipt, setOrderLimit,
} from '@radcore/lib-purchasing';
import {
  cancelGoodsReceipt, cancelPurchaseOrder, closePurchaseOrder, createGoodsReceipt, createPurchaseOrder, deleteGoodsReceipt, deletePurchaseOrder,
  getGoodsReceipt, getPurchaseOrder, listGoodsReceipts, listPurchaseOrderLimits, listPurchaseOrders, placePurchaseOrder, postGoodsReceipt,
  purchaseOrderApproval, setPurchaseOrderLimit, updateGoodsReceipt, updatePurchaseOrder,
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
  defineRoute(listGoodsReceipts, listReceiptsPage),
  defineRoute(getGoodsReceipt, getReceiptById),
  defineRoute(createGoodsReceipt, addReceipt),
  defineRoute(updateGoodsReceipt, changeReceipt),
  defineRoute(deleteGoodsReceipt, dropReceipt),
  defineRoute(postGoodsReceipt, postReceipt),
  defineRoute(cancelGoodsReceipt, cancelReceiptNow),
];
