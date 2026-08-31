// src/test/architecture/use-server-exports.test.ts
//
// REGRESSION GUARD for a whole class of production-breaking bug.
//
// Next.js permits a module carrying the `"use server"` directive to export
// NOTHING BUT async functions. Violating it does not fail `next build`; it
// throws at module-evaluation time in the running app:
//
//     A "use server" file can only export async functions, found object.
//
// The blast radius is the entire Server Actions bundle for whatever route
// imported it, not just the offending export. This actually shipped: a plain
// `export const FRANCHISE_USER_ACCESS_LEVELS = [...] as const` in
// `src/actions/master-actions/franchiseUserActions.ts` took down every Server
// Action on the master Franchise Hierarchy page. The Franchise Users dialog
// rendered fine and then died the moment it called `listFranchiseUsers`,
// bouncing the operator back to /dashboard. It went unnoticed because that
// dialog has no automated coverage and `npm run build` passed.
//
// THE FIX PATTERN, when a `"use server"` module needs to share a constant: move
// the constant into a pure module and import it from both sides. Precedents in
// this repo:
//   * `FRANCHISE_USER_ACCESS_LEVELS` / `FRANCHISE_OPERATIONS_GROUPS`
//     -> `src/lib/auth/adminAccessCore.ts`
//   * `mapClinicStockRpcError` -> `src/shared/utils/clinicStockErrors.ts`
//     (whose own header documents this exact constraint)
//
// Type-only exports (`export type`, `export interface`) are fine: TypeScript
// erases them, so they never reach the runtime export list.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();
const SRC_ROOT = join(REPO_ROOT, "src");

/** Source files worth scanning. Tests are excluded: they are never bundled. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/**
 * True when the module's FIRST statement is the `"use server"` directive.
 *
 * Deliberately precise rather than "the string appears near the top": several
 * pure modules mention `"use server"` in a header comment explaining why they
 * exist (`clinicStockErrors.ts` is one), and flagging those would be a false
 * positive that trains people to ignore this test.
 */
function hasUseServerDirective(source: string): boolean {
  const lines = source.split(/\r?\n/);
  let inBlockComment = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;

    if (inBlockComment) {
      if (line.includes("*/")) {
        inBlockComment = false;
        const after = line.slice(line.indexOf("*/") + 2).trim();
        if (after !== "") return /^["']use server["'];?/.test(after);
      }
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    // First real statement decides it.
    return /^["']use server["'];?/.test(line);
  }
  return false;
}

/**
 * Top-level exports that are NOT async functions, as `file:line: text`.
 *
 * Only column-0 `export` lines are considered — a nested `export` is not valid
 * TypeScript at any other indentation in these modules, and this keeps the
 * check free of a full AST parse.
 */
function findNonAsyncValueExports(relPath: string, source: string): string[] {
  const lines = source.split(/\r?\n/);
  const violations: string[] = [];

  lines.forEach((line, index) => {
    if (!line.startsWith("export")) return;

    // Erased at compile time — never a runtime export.
    if (/^export\s+(type|interface)\s/.test(line)) return;
    // `export type { ... }` / `export { type X }` are also type-only.
    if (/^export\s+type\s*\{/.test(line)) return;

    const report = () =>
      violations.push(`${relPath}:${index + 1}: ${line.trim()}`);

    if (/^export\s+async\s+function\s/.test(line)) return;
    if (/^export\s+function\s/.test(line)) {
      report();
      return;
    }
    if (/^export\s+(class|let|var)\s/.test(line)) {
      report();
      return;
    }
    if (/^export\s+const\s/.test(line)) {
      // An async arrow/function expression may sit on this line or wrap to the
      // next, e.g. `export const act =\n  async (input) => { ... }`.
      const continuation = `${line} ${(lines[index + 1] ?? "").trim()}`;
      if (!/=\s*async\b/.test(continuation)) report();
      return;
    }
    if (/^export\s+default\s/.test(line)) {
      if (!/^export\s+default\s+async\b/.test(line)) report();
      return;
    }
    // `export { ... }` / `export * from ...` re-export bindings defined
    // elsewhere; resolving them needs cross-module analysis, so they are out of
    // scope here rather than guessed at.
  });

  return violations;
}

describe('Architecture: every "use server" module exports only async functions', () => {
  const files = collectSourceFiles(SRC_ROOT);

  it("finds the server-action modules to check", () => {
    // Guards the guard: if the walker or the directive detector silently breaks,
    // this test would pass vacuously while checking nothing.
    const serverModules = files.filter((f) =>
      hasUseServerDirective(readFileSync(f, "utf8")),
    );
    expect(serverModules.length).toBeGreaterThan(50);
  });

  it("does not mistake a header comment mentioning the directive for the directive", () => {
    // `clinicStockErrors.ts` exists precisely BECAUSE of this rule and explains
    // so in its header. It is a pure module and must not be flagged.
    const pure = join(SRC_ROOT, "shared", "utils", "clinicStockErrors.ts");
    const source = readFileSync(pure, "utf8");
    expect(source).toContain("use server");
    expect(hasUseServerDirective(source)).toBe(false);
  });

  it("reports no non-async value export in any server-action module", () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!hasUseServerDirective(source)) continue;
      const relPath = relative(REPO_ROOT, file).split(sep).join("/");
      violations.push(...findNonAsyncValueExports(relPath, source));
    }

    expect(
      violations,
      violations.length === 0
        ? ""
        : `A "use server" module may export only async functions. Move these ` +
            `constants/types into a pure module and import them from both ` +
            `sides:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
