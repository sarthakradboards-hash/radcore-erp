// The printouts' routes (RAD-120): declarations only. Each renders on lib-platform's print pool in its `before`
// step, so it mounts only where the api's secrets library is, as every before step does.
import { definePrintRoute } from '@radcore/lib-platform';
import { purchaseOrderPrint, supplierReturnPrint } from '@radcore/lib-purchasing';
import { printPurchaseOrder, printSupplierReturn } from '@radcore/lib-purchasing/contract';
import { challanPrint, invoicePrint, quotePrint, receiptPrint } from '@radcore/lib-sales';
import { printChallan, printInvoice, printQuote, printReceipt } from '@radcore/lib-sales/contract';

export default [
  definePrintRoute(printInvoice, invoicePrint),
  definePrintRoute(printChallan, challanPrint),
  definePrintRoute(printQuote, quotePrint),
  definePrintRoute(printReceipt, receiptPrint),
  definePrintRoute(printPurchaseOrder, purchaseOrderPrint),
  definePrintRoute(printSupplierReturn, supplierReturnPrint),
];
