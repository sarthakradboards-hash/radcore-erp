// lib-platform's own jobs (ADR-001 §8): declarations only.
import { cleanOutbox, cleanSavedOnce, defineJob, outboxCleanup, savedOnceCleanup } from '@radcore/lib-platform';

export default [defineJob(savedOnceCleanup, cleanSavedOnce), defineJob(outboxCleanup, cleanOutbox)];
