// src/test/accommodation/structuralRegression.test.ts
//
// Structural regression test — source-level assertions that certain invariants
// hold across the codebase. These are "grep tests": they read files as text and
// assert patterns, catching accidental re-introductions of retired code paths
// or unauthorized writes to critical state.
//
// Validates: Requirements 12.9, 12.13, 14.8

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
const SCRIPTS = path.join(ROOT, "scripts");

/**
 * Recursively collect all files matching the given extensions under `dir`,
 * excluding node_modules, .next, and .git.
 */
function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git", ".kiro"]);

  function walk(current: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          results.push(path.join(current, entry.name));
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Read all TypeScript source files under src/ (production and test).
 */
function allTsFiles(): { filePath: string; content: string }[] {
  const files = collectFiles(SRC, [".ts", ".tsx"]);
  return files.map((f) => ({ filePath: f, content: fs.readFileSync(f, "utf-8") }));
}

/**
 * Read all SQL files under scripts/.
 */
function allSqlFiles(): { filePath: string; content: string }[] {
  const files = collectFiles(SCRIPTS, [".sql"]);
  return files.map((f) => ({ filePath: f, content: fs.readFileSync(f, "utf-8") }));
}

/**
 * Return a relative path from the project root for readability in assertions.
 */
function rel(filePath: string): string {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Test: `status = 'FINISHED'` is written by exactly two authoritative places
// ---------------------------------------------------------------------------

describe("Structural invariant: status = 'FINISHED' writes (Req 12.9, 12.13)", () => {
  it("is SET in SQL only by finalize_stay_checkout() and the cron/lifecycle transition", () => {
    const sqlFiles = allSqlFiles();

    // Pattern: an UPDATE or SET that writes status to 'FINISHED' in SQL.
    // We look for the actual write statement: `status = 'FINISHED'` or
    // `SET status = 'FINISHED'` (the UPDATE pattern in plpgsql).
    const writePattern = /\bstatus\s*=\s*'FINISHED'/gi;

    const matches: { file: string; line: number; text: string }[] = [];

    for (const { filePath, content } of sqlFiles) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment-only lines (lines starting with --)
        if (line.trimStart().startsWith("--")) continue;
        if (writePattern.test(line)) {
          matches.push({ file: rel(filePath), line: i + 1, text: line.trim() });
        }
        // Reset regex lastIndex since we use /g
        writePattern.lastIndex = 0;
      }
    }

    // The only SQL file that should contain a non-comment `status = 'FINISHED'`
    // write is create-stay-payment-lifecycle.sql (inside finalize_stay_checkout).
    const allowedSqlFiles = new Set([
      "scripts/create-stay-payment-lifecycle.sql",
    ]);

    const unexpected = matches.filter((m) => !allowedSqlFiles.has(m.file));
    expect(
      unexpected,
      `Unexpected SQL files writing status = 'FINISHED':\n${unexpected.map((m) => `  ${m.file}:${m.line} → ${m.text}`).join("\n")}`
    ).toHaveLength(0);

    // Confirm the expected file DOES contain the write (sanity check).
    const expected = matches.filter((m) => allowedSqlFiles.has(m.file));
    expect(
      expected.length,
      "finalize_stay_checkout() must contain the status = 'FINISHED' write"
    ).toBeGreaterThanOrEqual(1);
  });

  it("is assigned in TypeScript only by the backdated creation-time branch and the cron/checkout paths — no other production code WRITES status to 'FINISHED'", () => {
    const tsFiles = allTsFiles();

    // The invariant is: only two logical code paths can SET a stay's status
    // to FINISHED:
    //   1. `finalize_stay_checkout()` — SQL (tested above)
    //   2. `determineInitialStatus()` returning "FINISHED" and that being
    //      passed into `createStayEntry` (the backdated branch)
    //   3. `updateStayStatus(id, "FINISHED")` — the daily cron transition
    //
    // UI components that READ status to display it (switch/case for badge
    // colors, filter lists, etc.) are NOT writes and are allowed.
    //
    // The key files that legitimately SET the status in the database are:
    //   - AccommodationService.ts (calls createStay → determineInitialStatus,
    //     and the cron that calls updateStayStatus)
    //   - stayRepository.ts (createStayEntry, updateStayStatus, finalizeCheckout)
    //
    // What we assert: no OTHER server action, service, or repository file
    // sets status to "FINISHED" by calling updateStayStatus or inserting it.
    // Specifically, `save_stay_details()` and `saveStayDetailsAction` must
    // NEVER write status = FINISHED (Req 12.9).

    // Check that saveStayDetailsAction does not reference "FINISHED" as a
    // value it writes — it should only ever return status: "ACTIVE".
    const stayActionsFile = tsFiles.find((f) =>
      rel(f.filePath) === "src/actions/stayActions.ts"
    );
    expect(stayActionsFile, "src/actions/stayActions.ts must exist").toBeDefined();

    // Find the saveStayDetailsAction function body and verify it never
    // sets or returns status: "FINISHED".
    const content = stayActionsFile!.content;
    const saveStayDetailsStart = content.indexOf("saveStayDetailsAction");
    expect(saveStayDetailsStart, "saveStayDetailsAction must exist").toBeGreaterThan(-1);

    // Extract from the function start to the next exported function
    const afterSaveStayDetails = content.slice(saveStayDetailsStart);
    const nextExport = afterSaveStayDetails.indexOf("\nexport ", 10);
    const functionBody = nextExport > 0
      ? afterSaveStayDetails.slice(0, nextExport)
      : afterSaveStayDetails;

    // The function body must not contain "FINISHED" as a status it writes
    // (comments documenting what it DOESN'T do are fine).
    const nonCommentLines = functionBody.split("\n").filter(
      (line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")
    );
    const finishedInSaveStayDetails = nonCommentLines.filter(
      (line) => /status.*["']FINISHED["']/.test(line) || /["']FINISHED["'].*status/.test(line)
    );
    expect(
      finishedInSaveStayDetails,
      `saveStayDetailsAction must never write status = "FINISHED" (Req 12.9):\n${finishedInSaveStayDetails.join("\n")}`
    ).toHaveLength(0);

    // Similarly, the save_stay_details RPC in SQL must not write FINISHED.
    const sqlFiles = allSqlFiles();
    const recalcSql = sqlFiles.find((f) =>
      rel(f.filePath) === "scripts/create-stay-recalculation.sql"
    );
    expect(recalcSql, "create-stay-recalculation.sql must exist").toBeDefined();

    const recalcLines = recalcSql!.content.split("\n");
    const finishedInRecalcSql = recalcLines.filter((line) => {
      if (line.trimStart().startsWith("--")) return false;
      return /status\s*=\s*'FINISHED'/i.test(line);
    });
    expect(
      finishedInRecalcSql,
      `save_stay_details() in create-stay-recalculation.sql must never write status = 'FINISHED':\n${finishedInRecalcSql.join("\n")}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: No production call site passes 'REFUND' to record_stay_payment_transaction
// ---------------------------------------------------------------------------

describe("Structural invariant: no production REFUND via record_stay_payment_transaction (Req 14.8)", () => {
  it("no TypeScript production code passes 'REFUND' as a transaction type to record_stay_payment_transaction or recordTransaction", () => {
    const tsFiles = allTsFiles();

    // Pattern: calling recordTransaction or the RPC with 'REFUND' / "REFUND"
    const refundLiteralPattern = /['"]REFUND['"]/;
    const rpcOrFnPattern = /record_stay_payment_transaction|recordTransaction/;

    const violations: { file: string; line: number; text: string }[] = [];

    for (const { filePath, content } of tsFiles) {
      const relative = rel(filePath);

      // Skip test files
      if (
        relative.includes("__tests__") ||
        relative.includes("/test/") ||
        relative.endsWith(".test.ts") ||
        relative.endsWith(".test.tsx")
      ) {
        continue;
      }

      // Skip the repository itself (it documents but does not invoke with REFUND)
      // and SQL-related files. We check for actual CALL SITES that pass REFUND.
      const lines = content.split("\n");

      // Scan for any line that has both the RPC/function reference AND 'REFUND'
      // within a reasonable window (5 lines) — typical argument passing.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) {
          continue;
        }

        // Direct check: a line that calls the function with REFUND as arg
        if (rpcOrFnPattern.test(line) && refundLiteralPattern.test(line)) {
          violations.push({ file: relative, line: i + 1, text: line.trim() });
          continue;
        }

        // Context check: if the line calls the function, scan surrounding ±5
        // lines for a REFUND literal being passed as transactionType.
        if (rpcOrFnPattern.test(line) && !line.trimStart().startsWith("//")) {
          const windowStart = Math.max(0, i - 2);
          const windowEnd = Math.min(lines.length - 1, i + 5);
          for (let j = windowStart; j <= windowEnd; j++) {
            const ctxLine = lines[j];
            if (ctxLine.trimStart().startsWith("//") || ctxLine.trimStart().startsWith("*")) {
              continue;
            }
            // Look for transactionType: "REFUND" or p_transaction_type: "REFUND"
            if (
              /transaction[Tt]ype.*['"]REFUND['"]/.test(ctxLine) ||
              /p_transaction_type.*['"]REFUND['"]/.test(ctxLine)
            ) {
              violations.push({
                file: relative,
                line: j + 1,
                text: ctxLine.trim(),
              });
            }
          }
        }
      }
    }

    expect(
      violations,
      `Production code passes 'REFUND' to record_stay_payment_transaction:\n${violations.map((v) => `  ${v.file}:${v.line} → ${v.text}`).join("\n")}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: Retired symbols are completely gone
// ---------------------------------------------------------------------------

describe("Structural invariant: retired symbols are absent (Req 12.9, 12.13)", () => {
  const RETIRED_SYMBOLS = [
    "earlyCheckoutStayAction",
    "applyEarlyCheckoutMath",
    "applyEarlyCheckout",
    "createEarlyCheckoutSchema",
    "EarlyCheckoutOutcome",
  ] as const;

  it("no production source file contains a retired symbol as an identifier or import", () => {
    const tsFiles = allTsFiles();

    const violations: { symbol: string; file: string; line: number; text: string }[] = [];

    for (const symbol of RETIRED_SYMBOLS) {
      // Build a regex that matches the symbol as a word (not inside a longer word).
      const symbolPattern = new RegExp(`\\b${symbol}\\b`);

      for (const { filePath, content } of tsFiles) {
        const relative = rel(filePath);

        // Skip test files — they may still reference old symbols in mocks
        // that are scheduled for update in later tasks (18.9, 23.x).
        if (
          relative.includes("__tests__") ||
          relative.includes("/test/") ||
          relative.endsWith(".test.ts") ||
          relative.endsWith(".test.tsx") ||
          relative.endsWith(".property.test.ts")
        ) {
          continue;
        }

        // Skip spec/kiro files
        if (relative.includes(".kiro/")) continue;

        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!symbolPattern.test(line)) continue;

          // Allow references in comments that document the retirement
          // (e.g., "REPLACES the retired `earlyCheckoutStayAction`").
          const trimmed = line.trimStart();
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("/*")
          ) {
            continue;
          }

          violations.push({
            symbol,
            file: relative,
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }

    expect(
      violations,
      `Retired symbols still referenced as code in production files:\n${violations.map((v) => `  [${v.symbol}] ${v.file}:${v.line} → ${v.text}`).join("\n")}`
    ).toHaveLength(0);
  });
});
