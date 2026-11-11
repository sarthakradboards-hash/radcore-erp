// lib-platform's own jobs (ADR-001 §8): declarations only.
import {
  checkUpload, cleanOutbox, cleanSavedOnce, defineJob, fileCheck, outboxCleanup, recordFileCheck, savedOnceCleanup,
  secretsExpiryWatch, watchSecretExpiry, watchStuckDeliveries, webhookStuckWatch,
} from '@radcore/lib-platform';

export default [defineJob(savedOnceCleanup, cleanSavedOnce), defineJob(outboxCleanup, cleanOutbox),
  defineJob(secretsExpiryWatch, watchSecretExpiry), defineJob(webhookStuckWatch, watchStuckDeliveries),
  defineJob(fileCheck, recordFileCheck, checkUpload)];
