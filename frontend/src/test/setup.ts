import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// On Node 22.4+/24+, `globalThis.localStorage`/`sessionStorage` are native,
// but without a valid `--localstorage-file` they resolve to a non-functional
// stub object (getItem/setItem/clear are all undefined, only a runtime
// warning marks it). Vitest's jsdom environment only copies jsdom's real,
// working Storage implementation onto a global key when that key isn't
// already present on `global` — since the broken native stub is already
// there, it silently wins, and every test relying on localStorage/
// sessionStorage breaks (this repo's own Dark Mode Theme Engine persistence
// tests all failed with "localStorage.clear is not a function" before this
// fix). Re-point both at jsdom's real implementation, exposed by Vitest as
// `globalThis.jsdom.window`.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (typeof globalThis[key]?.getItem === 'function') continue;
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: jsdomWindow[key],
    });
  }
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;
