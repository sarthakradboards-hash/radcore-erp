// The tools tests' setup (RAD-134): a route that raised a code its contract doesn't declare warns (apps/api's
// undeclared.ts); here that warning fails the run, whatever the test asserts.
process.on('warning', (w) => {
  if (w.name === 'UndeclaredError') throw w;
});
