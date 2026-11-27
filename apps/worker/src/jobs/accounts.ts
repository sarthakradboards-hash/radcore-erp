// lib-accounts' jobs (ADR-001 §8): declarations only. A bank statement's import (RAD-159): the file read before the
// job's transaction, its lines checked and stored in it.
import { readStatementFile, statementImportJob, storeStatement } from '@radcore/lib-accounts';
import { defineJob } from '@radcore/lib-platform';

export default [defineJob(statementImportJob, storeStatement, { before: readStatementFile })];
