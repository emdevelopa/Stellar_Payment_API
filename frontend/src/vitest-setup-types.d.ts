/**
 * Registers @testing-library/jest-dom matchers on Vitest's `expect` for the whole project.
 * Prefer this over `compilerOptions.types: ["@testing-library/jest-dom"]`, which TypeScript
 * treats as a root `@types/*`-style package and often fails to resolve.
 */
import "@testing-library/jest-dom/vitest";

export {};
