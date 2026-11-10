// The device is never in India here, so a test that leans on the device's zone instead of India time fails (RC-204).
// Set through test.env, which also works on Windows, where Node ignores a TZ given at start. A plain object, so the
// package needs no vitest import of its own.
export default { test: { env: { TZ: 'America/Los_Angeles' } } };
