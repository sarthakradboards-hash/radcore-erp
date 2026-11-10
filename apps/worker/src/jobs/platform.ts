// lib-platform's own jobs (ADR-001 §8): declarations only.
import { cleanSavedOnce, defineJob, savedOnceCleanup } from '@radcore/lib-platform';

export default [defineJob(savedOnceCleanup, cleanSavedOnce)];
