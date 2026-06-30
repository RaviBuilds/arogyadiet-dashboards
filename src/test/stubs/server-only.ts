// Test-only stub for the `server-only` package.
//
// The real `server-only` module throws on import outside of a React Server
// Component / server graph, which would break unit tests that import otherwise
// pure server utilities. Vitest aliases `server-only` to this no-op stub.
export {};
