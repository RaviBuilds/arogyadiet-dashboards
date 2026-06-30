import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Structural lint test: Cross-portal import guard
 *
 * Validates that the Master portal directory never imports from other portal
 * route directories (Admin, Customer, Rider), and that the ESLint config
 * enforces this at build time.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4
 */

const MASTER_DIR = path.resolve(__dirname, "../../app/master");
const ESLINT_CONFIG_PATH = path.resolve(__dirname, "../../../eslint.config.mjs");

/** Forbidden import patterns – paths into other portal route directories */
const FORBIDDEN_PATTERNS = [
  /@\/app\/admin/,
  /@\/app\/customer/,
  /@\/app\/rider/,
  /["']\.\..*\/app\/admin\//,
  /["']\.\..*\/app\/customer\//,
  /["']\.\..*\/app\/rider\//,
];

/** Recursively collect all .ts and .tsx files under a directory */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

describe("Cross-portal import guard", () => {
  it("no file in src/app/master/ imports from @/app/admin, @/app/customer, or @/app/rider", () => {
    const files = collectTsFiles(MASTER_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: { file: string; line: number; content: string }[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Only check import/require statements
        if (!/\b(import|require)\b/.test(line)) continue;

        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: path.relative(MASTER_DIR, filePath),
              line: i + 1,
              content: line.trim(),
            });
            break; // one violation per line is enough
          }
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} → ${v.content}`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} forbidden cross-portal import(s) in src/app/master/:\n${report}`
      );
    }
  });

  it("eslint.config.mjs contains no-restricted-imports rule scoped to src/app/master/**", () => {
    const config = fs.readFileSync(ESLINT_CONFIG_PATH, "utf-8");

    // Verify the rule targets master portal files
    expect(config).toContain("src/app/master/**");

    // Verify no-restricted-imports rule is present
    expect(config).toContain("no-restricted-imports");

    // Verify it blocks @/app/admin imports
    expect(config).toContain("@/app/admin");

    // Verify it blocks @/app/customer imports
    expect(config).toContain("@/app/customer");

    // Verify it blocks @/app/rider imports
    expect(config).toContain("@/app/rider");
  });

  it("eslint.config.mjs rule provides a descriptive error message for forbidden imports", () => {
    const config = fs.readFileSync(ESLINT_CONFIG_PATH, "utf-8");

    // Verify descriptive messages exist for cross-portal violations
    expect(config).toMatch(/Forbidden cross-portal import/);
    expect(config).toMatch(/message/);
  });
});
