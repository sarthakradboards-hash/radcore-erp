// lib-platform's own jobs (ADR-001 §8): declarations only.
import {
  cleanOutbox, cleanSavedOnce, defineJob, outboxCleanup, savedOnceCleanup, secretsExpiryWatch, watchSecretExpiry,
  watchStuckDeliveries, webhookStuckWatch,
} from '@radcore/lib-platform';

export default [defineJob(savedOnceCleanup, cleanSavedOnce), defineJob(outboxCleanup, cleanOutbox),
  defineJob(secretsExpiryWatch, watchSecretExpiry), defineJob(webhookStuckWatch, watchStuckDeliveries)];
