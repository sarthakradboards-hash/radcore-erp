// The one export job (RAD-47, ADR-001 §8b): every module's exports run on it, one at a time. Each module that has
// exports spreads its list in here, as `defineExportJob([...sales.salesExports, ...crm.crmExports])`.
import { defineExportJob } from '@radcore/lib-platform';

export default [defineExportJob([])];
