// The masters workbook (RAD-92, ADR-001 §8b): lib-platform's contract with each module's sheets, joined here, in the
// worker, the one place that may import every module, so the export job's reach honestly names them. The API's start
// route needs only the contract.
import { workbookOf } from '@radcore/lib-platform';
import { mastersExport } from '@radcore/lib-platform/contract';
import { hrSheets } from '@radcore/lib-hr';
import { stockSheets } from '@radcore/lib-stock';

export const masters = workbookOf(mastersExport, [...stockSheets, ...hrSheets]);
