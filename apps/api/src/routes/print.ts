// The printouts' routes (RAD-120): declarations only. Each renders on lib-platform's print pool in its `before`
// step, so it mounts only where the api's secrets library is, as every before step does.
import { definePrintRoute } from '@radcore/lib-platform';
import { challanPrint, invoicePrint, quotePrint } from '@radcore/lib-sales';
import { printChallan, printInvoice, printQuote } from '@radcore/lib-sales/contract';

export default [
  definePrintRoute(printInvoice, invoicePrint),
  definePrintRoute(printChallan, challanPrint),
  definePrintRoute(printQuote, quotePrint),
];
