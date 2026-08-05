// src/actions/dietitian-actions/__tests__/report-card-scope.property.test.ts
// Feature: report-card-lifecycle — Phase 2/4, action-layer scoping.
//
// Property 18 — an unknown Report_Card id and an id belonging to a customer
// outside the caller's scope produce IDENTICAL responses.
//
// This is not a cosmetic consistency check. A Report_Card is addressed by its own
// opaque id, so the scope check can only run after the owning customer has been
// resolved. If "no such report" and "not your report" differed in any way — a
// different message, a different shape, even different wording — a Dietitian
// could enumerate ids and learn which ones exist, and therefore which customers
// another Dietitian is treating. The two responses have to be indistinguishable,
// which is why the assertion is on deep equality rather than on a message.
//
// Every mutating action is covered too, not just the reads: `finaliseReport` and
// `reopenReport` take an id and would leak the same information.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const state: any = {
    /** The card `getReportCardById` returns, or null for "unknown id". */
    card: null as any,
    /** Whether `checkDietitianScope` grants access. */
    inScope: true,
  };

  function reset() {
    state.card = null;
    state.inScope = true;
  }

  return { state, reset };
});

vi.mock("@/lib/auth/adminAccess", () => ({
  checkDietitianScope: vi.fn(async () =>
    H.state.inScope
      ? { ok: true, ctx: { userId: "u-1", clinicId: null, franchiseId: null } }
      : // A deliberately distinctive message: if the action ever forwarded
        // `scope.error` instead of the not-found message, this string would show
        // up in the response and the property would fail.
        { ok: false, error: "SCOPE-SPECIFIC-LEAK" },
  ),
  guardDietitianPage: vi.fn(async () => undefined),
}));

vi.mock("@/repositories/dietitian/reportCardRepository", () => ({
  getReportCardById: vi.fn(async () => H.state.card),
}));

vi.mock("@/services/ReportCardService", () => ({
  getReportCardHistory: vi.fn(async () => ({
    customerProfileId: "cust-1",
    category: "MEAL",
    entries: [],
  })),
  getReportCardDetail: vi.fn(async () => ({
    reportCard: H.state.card,
    slots: [],
    timeline: [],
    totalSlots: 0,
    loggedSlots: 0,
    isComplete: false,
  })),
  finaliseReport: vi.fn(async () => ({ ok: true, reportCard: H.state.card })),
  reopenReport: vi.fn(async () => ({ ok: true, reportCard: H.state.card })),
}));

vi.mock("@/services/DietitianReportService", () => ({
  getPeriodReport: vi.fn(async () => ({ ok: true, report: { stub: true } })),
  generatePeriodReportPdf: vi.fn(async () => ({
    ok: true,
    pdf: Buffer.from("pdf"),
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import {
  exportPeriodReportPdfAction,
  finaliseReportAction,
  getPeriodReportAction,
  getReportCardDetailAction,
  reopenReportAction,
} from "@/actions/dietitian-actions/reportCardLifecycleActions";

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildCard(id: string) {
  return {
    id,
    customerProfileId: "cust-other",
    subjectType: "SUBSCRIPTION" as const,
    subscriptionId: "sub-1",
    stayEntryId: null,
    category: "MEAL" as const,
    windowStart: "2026-01-01",
    windowEnd: "2026-01-31",
    status: "ACTIVE" as const,
    reportClosingComment: null,
    finalisedAt: null,
    finalisedBy: null,
    reopenCount: 0,
    lastReopenedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isEditable: true,
    isReopenable: false,
    isRetrospective: false,
  };
}

/** Every id-addressed action, each invoked the same way. */
const ACTIONS: Array<{
  name: string;
  run: (id: string) => Promise<unknown>;
}> = [
  { name: "getReportCardDetailAction", run: (id) => getReportCardDetailAction(id) },
  { name: "finaliseReportAction", run: (id) => finaliseReportAction(id, "Done.") },
  { name: "reopenReportAction", run: (id) => reopenReportAction(id) },
  { name: "getPeriodReportAction", run: (id) => getPeriodReportAction(id) },
  {
    name: "exportPeriodReportPdfAction",
    run: (id) => exportPeriodReportPdfAction(id),
  },
];

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe("Property 18: Identifier probing is impossible", () => {
  it("returns an identical response for an unknown id and an out-of-scope id", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(...ACTIONS.map((a) => a.name)),
        async (id, actionName) => {
          const action = ACTIONS.find((a) => a.name === actionName)!;

          // Case A — the id does not exist at all.
          H.reset();
          H.state.card = null;
          H.state.inScope = true;
          const unknown = await action.run(id);

          // Case B — the id exists but belongs to somebody else's customer.
          H.reset();
          H.state.card = buildCard(id);
          H.state.inScope = false;
          const outOfScope = await action.run(id);

          // Byte-identical, so neither the shape nor the wording distinguishes
          // "does not exist" from "not yours".
          expect(outOfScope).toEqual(unknown);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never forwards the scope-specific error to the caller", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(...ACTIONS.map((a) => a.name)),
        async (id, actionName) => {
          const action = ACTIONS.find((a) => a.name === actionName)!;

          H.reset();
          H.state.card = buildCard(id);
          H.state.inScope = false;

          const result = (await action.run(id)) as any;

          expect(result.success).toBe(false);
          // `checkDietitianScope`'s own message must not reach the response —
          // it would identify the refusal as a scope failure, which is exactly
          // the distinction that leaks existence.
          expect(result.error).not.toBe("SCOPE-SPECIFIC-LEAK");
          expect(result.error).toBe("Report not found.");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("performs no work for an out-of-scope id", async () => {
    const { getReportCardDetail } = await import("@/services/ReportCardService");
    const { finaliseReport } = await import("@/services/ReportCardService");

    H.reset();
    H.state.card = buildCard("11111111-1111-4111-8111-111111111111");
    H.state.inScope = false;

    await getReportCardDetailAction(H.state.card.id);
    await finaliseReportAction(H.state.card.id, "Done.");

    // The scope check must gate the work, not merely filter its result — an
    // out-of-scope finalise that ran and was then hidden would still have closed
    // somebody else's report.
    expect(vi.mocked(getReportCardDetail)).not.toHaveBeenCalled();
    expect(vi.mocked(finaliseReport)).not.toHaveBeenCalled();
  });

  it("succeeds for an in-scope id, so the refusals above are not vacuous", async () => {
    H.reset();
    H.state.card = buildCard("22222222-2222-4222-8222-222222222222");
    H.state.inScope = true;

    for (const action of ACTIONS) {
      const result = (await action.run(H.state.card.id)) as any;
      expect(result.success).toBe(true);
    }
  });
});
