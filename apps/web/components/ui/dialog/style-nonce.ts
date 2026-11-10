// Radix's scroll lock (modal dialogs and menus) adds a <style> element, which the CSP (proxy.ts) allows only with
// this page's nonce. Next has already put the nonce on its own scripts; the property keeps it after the browser hides
// the attribute. The lock's style library (get-nonce) reads the nonce from this global.
// shortcut: works because Turbopack leaves get-nonce's `__webpack_nonce__` as a global; if the build moves to webpack,
// which rewrites it, call get-nonce's setNonce instead. The e2e dialog test fails on the CSP violation either way.
if (typeof document !== 'undefined') {
  Object.assign(globalThis, { __webpack_nonce__: document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce });
}
