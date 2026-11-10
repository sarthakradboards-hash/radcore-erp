// The isolate's zone lifts node:worker_threads only: fetch stays refused.
export const r = fetch('https://example.com');
