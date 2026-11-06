export const copy = <T>(x: T) => globalThis.structuredClone(x);
export const later = (f: () => void) => globalThis?.queueMicrotask(f);
