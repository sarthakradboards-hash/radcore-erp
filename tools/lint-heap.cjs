// RAD-89 part 4 (the architect's ruling): the lint run's peak memory, measured against a budget, so headroom is seen
// shrinking long before ESLint runs out of V8's default heap (it did on #224, in D7's typed export walk). Loaded with
// `node --require`, it prints the run's maximum resident set size and V8's heap limit when it ends, and fails the run
// above the budget.
// Reference peaks: CI (Linux) 2855 MB at f143bb0d; Windows 2414 to 2731 MB over four local runs; 4188 MB on dev before
// part 4. The budget leaves room for ordinary growth under the ~4 GB a run fails at; raise it only with a measured
// reason, never by giving ESLint a bigger heap.
const { getHeapStatistics } = require('node:v8');

const BUDGET_MB = 3584;

process.on('exit', () => {
  // resourceUsage().maxRSS is in kilobytes, on Linux and Windows alike.
  const peakMb = Math.round(process.resourceUsage().maxRSS / 1024);
  const heapLimitMb = Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024);
  process.stdout.write(`lint peak memory: ${peakMb} MB (budget ${BUDGET_MB} MB, V8 heap limit ${heapLimitMb} MB)\n`);
  if (peakMb > BUDGET_MB) {
    process.stderr.write('Lint used more memory than its budget: find what grew (D7\'s type walk first), don\'t raise the heap.\n');
    process.exitCode = 1;
  }
});
