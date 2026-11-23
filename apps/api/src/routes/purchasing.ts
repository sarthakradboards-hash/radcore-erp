// lib-purchasing's routes (ADR-001 §6): declarations only. Purchase orders, their approval and the PO limits (RAD-136);
// goods receipts (RAD-137); purchase bills (RAD-138): drafts, posting, its approval and cancelling.
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import {
  addBill, addOrder, addReceipt, billApproval, cancelBillNow, cancelOrder, cancelReceiptNow, changeBill, changeOrder, changeReceipt, closeOrder, dropBill, dropOrder,
  dropReceipt, getBillById, getOrderById, getReceiptById, listBillsPage, listOrderLimits, listOrdersPage, listReceiptsPage, orderApproval,
  placeOrder, postBillNow, postReceipt, setOrderLimit,
} from '@radcore/lib-purchasing';
import {
  cancelGoodsReceipt, cancelPurchaseBill, cancelPurchaseOrder, closePurchaseOrder, createGoodsReceipt, createPurchaseBill, createPurchaseOrder, deleteGoodsReceipt,
  deletePurchaseBill, deletePurchaseOrder, getGoodsReceipt, getPurchaseBill, getPurchaseOrder, listGoodsReceipts, listPurchaseBills,
  listPurchaseOrderLimits, listPurchaseOrders, placePurchaseOrder, postGoodsReceipt, postPurchaseBill, purchaseBillApproval, purchaseOrderApproval,
  setPurchaseOrderLimit,
  updateGoodsReceipt, updatePurchaseBill, updatePurchaseOrder,
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
  defineRoute(listPurchaseBills, listBillsPage),
  defineRoute(getPurchaseBill, getBillById),
  defineRoute(createPurchaseBill, addBill),
  defineRoute(updatePurchaseBill, changeBill),
  defineRoute(deletePurchaseBill, dropBill),
  defineRoute(postPurchaseBill, postBillNow),
  ...defineApproval(purchaseBillApproval, billApproval),
  defineRoute(cancelPurchaseBill, cancelBillNow),
];
