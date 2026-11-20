// RAD-89 part 4 (the architect's ruling): the lint run's memory, measured against a budget, so headroom is seen shrinking
// long before ESLint runs out of V8's heap (it did on #224, in D7's typed export walk). Loaded with `node --expose-gc
// --require`, it collects garbage when the run ends and fails it when the live heap left is above 75% of V8's heap limit.
// Peak RSS is printed for information only: it swings ~2400–2850 MB on CI with when garbage is collected, so a gate on
// it flaps (#235's +510 MB was that noise).
// Reference live heaps: <filled from CI runs>. Raise the share only with a measured reason, never by giving ESLint a
// bigger heap.
const { getHeapStatistics } = require('node:v8');

const BUDGET_SHARE = 0.75;
const mb = (bytes) => Math.round(bytes / 1024 / 1024);

process.on('exit', () => {
  if (typeof global.gc !== 'function') {
    process.stderr.write('lint-heap.cjs needs node --expose-gc to measure the live heap.\n');
    process.exitCode = 1;
    return;
  }
  global.gc();
  const liveMb = mb(process.memoryUsage().heapUsed);
  const limitMb = mb(getHeapStatistics().heap_size_limit);
  const budgetMb = Math.round(limitMb * BUDGET_SHARE);
  // resourceUsage().maxRSS is in kilobytes, on Linux and Windows alike.
  const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  process.stdout.write(`lint live heap: ${liveMb} MB (budget ${budgetMb} MB, 75% of V8's ${limitMb} MB); peak RSS ${peakRssMb} MB\n`);
  if (liveMb > budgetMb) {
    process.stderr.write('Lint\'s live heap is over its budget: find what grew (D7\'s type walk first), don\'t raise the heap.\n');
    process.exitCode = 1;
  }
});
