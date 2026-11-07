// Test-only helpers (RAD-49, M1-31). Only *.test.ts files may import this package (.dependency-cruiser.cjs), so
// nothing here can change how production code runs (RC-155).
export { fakeClock, type FakeClock } from './clock.ts';
export { factory, type Fresh } from './factory.ts';
