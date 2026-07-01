import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    // Node remains the default environment so existing unit/property tests are
    // unaffected. DOM component tests opt in per-file with a
    // `// @vitest-environment jsdom` docblock (Task 11.3).
    environment: "node",
    // setup-dom registers jest-dom matchers (safe in node) and, guarded behind
    // a window/document check, the jsdom polyfills Radix primitives need.
    setupFiles: ["./src/test/setup-dom.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws when imported outside a server graph; stub it so
      // pure server utilities remain unit-testable.
      "server-only": path.resolve(__dirname, "./src/test/stubs/server-only.ts"),
    },
  },
});
