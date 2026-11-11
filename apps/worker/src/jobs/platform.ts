// lib-platform's own jobs (ADR-001 §8): declarations only.
import {
  checkUpload, cleanOutbox, cleanSavedOnce, defineJob, fileCheck, outboxCleanup, recordFileCheck, savedOnceCleanup,
  secretsExpiryWatch, watchSecretExpiry,
} from '@radcore/lib-platform';

export default [defineJob(savedOnceCleanup, cleanSavedOnce), defineJob(outboxCleanup, cleanOutbox),
  defineJob(secretsExpiryWatch, watchSecretExpiry), defineJob(fileCheck, recordFileCheck, checkUpload)];
