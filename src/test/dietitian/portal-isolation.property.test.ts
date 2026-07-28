// src/test/dietitian/portal-isolation.property.test.ts
// Feature: dietitian-management, Property 36
//
// Property 36: The Franchise Portal imports nothing from the Admin Portal.
//
// For all files under src/app/franchise, no import specifier resolves into
// src/app/admin, and every shared logging component import resolves into
// src/shared.
//
// Validates: Requirements 23.7
//
// This is a structural invariant over a fixed, enumerable file set rather
// than a randomized data property (there is no meaningful "generator" for
// "the set of files in this repository"). Following the pattern already
// established for this spec's structural checks (see
// src/lib/auth/__tests__/operational-write-denial.property.test.ts's
// franchiseUserActions / healthLogRepository checks, and
// src/test/inventory/cross-portal-lint-guard.test.ts for the analogous
// Master-portal guard), the invariant is asserted directly against every
// file. It is additionally wrapped in a fast-check property over every
// permutation of the enumerated file list so the check runs >=100 times
// per the project's PBT convention — the invariant is order-independent by
// construction, so this proves the same thing the direct assertion proves,
// just repeated across shuffles of iteration order.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const FRANCHISE_DIR = path.join(REPO_ROOT, "src", "app", "franchise");
const ADMIN_DIR = path.join(REPO_ROOT, "src", "app", "admin");
const SHARED_DIR = path.join(REPO_ROOT, "src", "shared");

const NUM_RUNS = 150;

/**
 * Every shared logging component this feature placed under
 * `src/shared/components/dietitian/` (design.md section 12). A franchise
 * file that imports one of these by name must resolve it into
 * `src/shared`, never redefine or re-source it from elsewhere (in
 * particular never from `src/app/admin`).
 */
const DIETITIAN_SHARED_COMPONENTS = [
  "CustomParameterEditor",
  "DietitianActivityReport",
  "HealthLogEntryWorkspace",
  "HealthLogForm",
  "HealthLogTimeline",
  "LogCustomerList",
  "ReportCardView",
  "SelfLogAdherencePanel",
  "SelfLogReferencePanel",
] as const;

interface ImportSpecifier {
  /** The raw specifier string inside the quotes, e.g. "@/app/admin/foo". */
  specifier: string;
  /** The full import/require statement text the specifier was found in. */
  statement: string;
}

/** Recursively collect all .ts and .tsx files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extracts every static `import ... from "..."`, bare `import "..."` and
 * `require("...")` specifier from a source file's text, alongside the
 * enclosing statement (used for the shared-component named-import check).
 */
function extractImportSpecifiers(source: string): ImportSpecifier[] {
  const results: ImportSpecifier[] = [];

  const importFromPattern = /import\s+[^;]*?\sfrom\s+["']([^"']+)["']/g;
  const bareImportPattern = /import\s+["']([^"']+)["']/g;
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [
    importFromPattern,
    bareImportPattern,
    requirePattern,
    dynamicImportPattern,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      results.push({ specifier: match[1], statement: match[0] });
    }
  }

  return results;
}

/** Resolves an import specifier from `fromFile` to an absolute path, or null if it can't be a filesystem path (e.g. a bare npm package). */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith("@/")) {
    // tsconfig.json: "@/*" -> "./src/*"
    return path.join(REPO_ROOT, "src", specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  // Bare package specifier (e.g. "react", "next/navigation") — not a
  // filesystem path within this repo.
  return null;
}

/** True iff `resolvedPath` is `dir` itself or lives anywhere underneath it. */
function isWithin(resolvedPath: string, dir: string): boolean {
  const rel = path.relative(dir, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const franchiseFiles = collectSourceFiles(FRANCHISE_DIR);

// Source text is read from disk exactly once per file and reused across all
// fast-check runs below — the property varies iteration *order* only, so
// re-reading the same immutable file contents on every run would be pure
// overhead (and, at 150 runs x 50+ files, slow enough to blow the test
// timeout for no benefit).
const fileContents = new Map<string, string>(
  franchiseFiles.map((file) => [file, fs.readFileSync(file, "utf8")]),
);

/** Every forbidden-import violation found across all franchise files. */
function findAdminImportViolations(
  files: readonly string[],
): { file: string; specifier: string; statement: string }[] {
  const violations: { file: string; specifier: string; statement: string }[] = [];

  for (const file of files) {
    const source = fileContents.get(file) ?? fs.readFileSync(file, "utf8");
    for (const { specifier, statement } of extractImportSpecifiers(source)) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved !== null && isWithin(resolved, ADMIN_DIR)) {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          specifier,
          statement: statement.trim(),
        });
      }
    }
  }

  return violations;
}

/**
 * Every violation where a franchise file imports one of the named shared
 * logging components from anywhere other than `src/shared`.
 */
function findMisresolvedSharedComponentViolations(
  files: readonly string[],
): { file: string; component: string; specifier: string }[] {
  const violations: { file: string; component: string; specifier: string }[] = [];
  const namePattern = new RegExp(`\\b(${DIETITIAN_SHARED_COMPONENTS.join("|")})\\b`);

  for (const file of files) {
    const source = fileContents.get(file) ?? fs.readFileSync(file, "utf8");
    const importFromPattern = /import\s+([^;]*?)\sfrom\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importFromPattern.exec(source)) !== null) {
      const [, namedClause, specifier] = match;
      const nameMatch = namedClause.match(namePattern);
      if (!nameMatch) continue;

      const resolved = resolveSpecifier(specifier, file);
      const resolvesIntoShared = resolved !== null && isWithin(resolved, SHARED_DIR);
      if (!resolvesIntoShared) {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          component: nameMatch[1],
          specifier,
        });
      }
    }
  }

  return violations;
}

describe("Property 36: The Franchise Portal imports nothing from the Admin Portal", () => {
  it("sanity: the franchise portal directory contains source files to check", () => {
    expect(franchiseFiles.length).toBeGreaterThan(0);
  });

  it("no file under src/app/franchise imports (statically, dynamically, or via require) anything that resolves into src/app/admin", () => {
    const violations = findAdminImportViolations(franchiseFiles);

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file} -> "${v.specifier}" (${v.statement})`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} forbidden Franchise -> Admin import(s):\n${report}`,
      );
    }
  });

  it("every shared logging component (src/shared/components/dietitian/*) imported by a franchise file resolves into src/shared", () => {
    const violations = findMisresolvedSharedComponentViolations(franchiseFiles);

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file} -> ${v.component} from "${v.specifier}"`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} shared logging component import(s) not resolving into src/shared:\n${report}`,
      );
    }
  });

  // ─── Property form: the invariant holds regardless of iteration order ─────
  //
  // The invariant above is a "for all files" universal, not a randomized
  // data property — there is nothing to vary about a fixed file's contents.
  // This property varies the *order* files are checked in, over every
  // permutation of the enumerated set, to run the same invariant >=100
  // times per the project's PBT convention and confirm the result never
  // depends on iteration order (no accidental early-return/short-circuit
  // bugs in the scanning helpers).

  it(
    "holds for every permutation of the enumerated franchise file list (order-independence, >=100 runs)",
    () => {
      fc.assert(
        fc.property(fc.shuffledSubarray(franchiseFiles, { minLength: franchiseFiles.length }), (shuffled) => {
          expect(shuffled).toHaveLength(franchiseFiles.length);
          expect(findAdminImportViolations(shuffled)).toHaveLength(0);
          expect(findMisresolvedSharedComponentViolations(shuffled)).toHaveLength(0);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    20000,
  );
});
