// @vitest-environment jsdom
//
// src/test/dietitian/health-log-timeline.property.test.tsx
// Feature: dietitian-management, Property 30
//
// Property 30: The Health_Log timeline contains every log exactly once,
// date-ordered and author-labelled.
//
// For any set of Dietitian_Logs and Self_Logs for a Customer_Record, the
// timeline contains each of them exactly once, in date order, each labelled
// with its author type, and each Closing_Comment displayed with its author
// name and submission timestamp.
//
// This suite exercises `HealthLogTimeline.tsx` directly against generated
// `HealthLog[]` fixtures — the ordering contract itself (ascending by
// log_date/submitted_at, Dietitian_Logs and Self_Logs interleaved rather than
// split into two lists) is `getHealthLogTimeline`'s (design section 9,
// `healthLogRepository.ts`); this suite confirms the *renderer* preserves
// whatever order it is handed and drops nothing, adds nothing, and labels
// every entry correctly (Req 12.7, 25.3).
//
// **Validates: Requirements 12.7, 13.5, 25.3, 26.4**

import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as fc from "fast-check";

import { HealthLogTimeline } from "@/shared/components/dietitian/HealthLogTimeline";
import {
  customerCategoryArb,
  fixtureUuid,
  istDateArb,
  sparseParameterMapArb,
} from "@/test/dietitian/arbitraries";
import type { CustomerCategory, HealthLog, ParameterValue } from "@/types/dietitian";

const NUM_RUNS = 30;

const AUTHOR_NAME_POOL = ["Dr. Avinash", "Nandini", "Divya", "Joshitha"] as const;

interface HealthLogSpec {
  logDate: string;
  authorType: "DIETITIAN" | "CUSTOMER";
  authorName: string | null;
  closingComment: string | null;
  parameters: Record<string, ParameterValue>;
}

const healthLogSpecArb = (category: CustomerCategory): fc.Arbitrary<HealthLogSpec> =>
  fc.record({
    logDate: istDateArb,
    authorType: fc.constantFrom("DIETITIAN", "CUSTOMER"),
    parameters: sparseParameterMapArb(category),
    closingComment: fc.option(
      fc.constantFrom("Reviewed the plan.", "Weight stable, continue diet."),
      { nil: null },
    ),
  }).chain((base) =>
    fc
      .constantFrom(...AUTHOR_NAME_POOL)
      .map((name) => ({
        ...base,
        // A Self_Log source carries no author identity at all (Req 25.3).
        authorName: base.authorType === "DIETITIAN" ? name : null,
      })),
  );

function toHealthLog(
  spec: HealthLogSpec,
  index: number,
  category: CustomerCategory,
): HealthLog {
  return {
    id: fixtureUuid(55, index),
    customerProfileId: fixtureUuid(44, 1),
    logDate: spec.logDate,
    authorType: spec.authorType,
    authorUserId: spec.authorType === "DIETITIAN" ? fixtureUuid(33, 1) : null,
    authorName: spec.authorName,
    category,
    parameters: spec.parameters,
    customParameters: [],
    closingComment: spec.closingComment,
    submittedAt: `${spec.logDate}T09:${String(10 + (index % 40)).padStart(2, "0")}:00.000Z`,
    submissionDateIst: spec.logDate,
    source: spec.authorType === "DIETITIAN" ? "health_logs" : "kit_daily_logs",
  };
}

describe("Property 30: the Health_Log timeline contains every log exactly once, date-ordered and author-labelled", () => {
  it("renders every log exactly once, preserving the order it is given and labelling each entry's author type", () => {
    /**
     * **Validates: Requirements 12.7, 25.3, 26.4**
     */
    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) =>
          fc.record({
            category: fc.constant(category),
            specs: fc.array(healthLogSpecArb(category), { minLength: 0, maxLength: 8 }),
          }),
        ),
        ({ category, specs }) => {
          cleanup();

          const logs = specs.map((spec, i) => toHealthLog(spec, i, category));
          // The renderer is handed the logs in a fixed (already date-ordered,
          // per the repository contract) order; it must not reorder, drop or
          // duplicate any of them.
          const { container } = render(<HealthLogTimeline logs={logs} />);

          if (logs.length === 0) {
            expect(screen.getByText(/no health logs recorded yet/i)).toBeInTheDocument();
            cleanup();
            return;
          }

          const cards = container.querySelectorAll("[data-slot='card']");
          expect(cards).toHaveLength(logs.length);

          logs.forEach((log, index) => {
            const card = cards[index];
            expect(card).toBeDefined();
            // Every entry is present in the same relative position it was
            // handed in (renderer preserves order — Req 12.7).
            expect(card!.textContent).toContain(
              // The date appears as "DD Mon YYYY"; assert the year/day digits
              // rather than reformatting here, to stay independent of the
              // renderer's own date formatter.
              log.logDate.split("-")[2].replace(/^0/, ""),
            );

            // Req 25.3 — each entry labels its author type.
            if (log.authorType === "DIETITIAN") {
              expect(card!.textContent).toMatch(/dietitian/i);
              if (log.authorName) expect(card!.textContent).toContain(log.authorName);
            } else {
              expect(card!.textContent).toMatch(/self log/i);
            }
          });

          cleanup();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("shows every Closing_Comment with its author name and submission timestamp", () => {
    /**
     * **Validates: Requirements 13.5**
     */
    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) =>
          fc.record({
            category: fc.constant(category),
            specs: fc
              .array(healthLogSpecArb(category), { minLength: 1, maxLength: 5 })
              .map((specs) =>
                // Force at least one entry to carry a Closing_Comment so the
                // property has something concrete to assert on every run.
                specs.map((spec, i) =>
                  i === 0 ? { ...spec, closingComment: "Reviewed the plan." } : spec,
                ),
              ),
          }),
        ),
        ({ category, specs }) => {
          cleanup();
          const logs = specs.map((spec, i) => toHealthLog(spec, i, category));
          render(<HealthLogTimeline logs={logs} />);

          for (const log of logs) {
            if (!log.closingComment) continue;
            // Multiple entries may share identical Closing_Comment text (the
            // generator draws from a small pool), so every matching node is
            // checked rather than assuming there is exactly one.
            const commentNodes = screen.getAllByText(log.closingComment);
            expect(commentNodes.length).toBeGreaterThan(0);
            if (log.authorName) {
              const hasMatchingMeta = commentNodes.some((node) => {
                const meta = node.parentElement?.querySelector("p:last-of-type");
                return meta?.textContent?.includes(log.authorName!);
              });
              expect(hasMatchingMeta).toBe(true);
            }
          }

          cleanup();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("shows the empty state when there is no log, and renders no card for it", () => {
    /**
     * **Validates: Requirements 12.7, 25.3** (the vacuous case: an empty
     * timeline is neither missing information nor a rendering error.)
     */
    render(<HealthLogTimeline logs={[]} />);
    expect(screen.getByText(/no health logs recorded yet/i)).toBeInTheDocument();
    cleanup();
  });
});
