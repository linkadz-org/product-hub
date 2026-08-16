import { Storage } from 'happy-dom';

// On Node >=22 (confirmed on this repo's Node 26 line), `globalThis.localStorage` /
// `globalThis.sessionStorage` are lazily-initialised experimental Node APIs — accessors
// that exist on `global` before Vitest's happy-dom environment ever runs, and that throw
// or return undefined unless the process was started with `--localstorage-file`.
//
// Vitest's environment setup (`populateGlobal` in vitest/dist/chunks/index.*.js) copies
// happy-dom's window properties onto the global scope, but *deliberately skips* any key
// that already exists on `global` unless that key is in its own hardcoded whitelist —
// and `localStorage`/`sessionStorage` are not in that whitelist. Because Node already
// defines both, Vitest leaves Node's broken accessors in place instead of installing
// happy-dom's working `Storage`. The result: `window.localStorage` inside a test is
// itself Node's broken global (not happy-dom's), so reassigning `globalThis.localStorage
// = window.localStorage` does nothing — both sides of that assignment already resolve to
// the same broken accessor.
//
// Fix: install happy-dom's own `Storage` implementation directly, bypassing the window
// proxy entirely. This makes `localStorage`/`sessionStorage` behave identically to a
// real browser regardless of which Node version is running the tests — no Node version
// pin required.
Object.defineProperty(globalThis, 'localStorage', {
  value: new Storage(),
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: new Storage(),
  configurable: true,
  writable: true,
});
