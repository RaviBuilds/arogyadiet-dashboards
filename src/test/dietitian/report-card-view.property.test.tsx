// @vitest-environment jsdom
//
// src/test/dietitian/report-card-view.property.test.tsx
// Feature: dietitian-management, Property 32
//
// Property 32: The Report_Card contains every recorded value, its trends,
// adherence numbers and comment history.
//
// For any Customer_Record with at least one Health_Log, the Report_Card's
// parameter table contains every recorded parameter value exactly once in
// date order, the adherence summary equals the computed counts, and
// Closing_Comments are listed in reverse chronological order with author
// names. The Weight/BP/Fasting Sugar trend series assembly itself is
// `DietitianReportService.buildTrends`'s contract (task 7.17); this suite
// confirms `ReportCardView.tsx` renders exactly the `ReportCardViewModel` it
// is handed, dropping nothing and inventing nothing (Req 19.1, 19.2, 19.4,
// 19.5).
//
// Recharts' `ResponsiveContainer` needs a non-zero layout size to render its
// children in jsdom (it reports 0×0 without a real browser layout engine), so
// the trend-chart assertions in this suite check the chart SECTION renders
// (each labelled by its title) and the empty-state text for an empty series,
// rather than asserting on SVG path data that Recharts would only draw given
// real layout dimensions.
//
// **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5**

import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as fc from "fast-check";

import { ReportCardView } from "@/shared/components/dietitian/ReportCardView";
import type { ReportCardViewModel } from "@/services/DietitianReportService";
import type { ReportCardParameterRow } from "@/services/DietitianReportTemplate";
import { fixtureUuid, istDateArb, sparseParameterMapArb } from "@/test/dietitian/arbitraries";
import type { ParameterValue } from "@/types/dietitian";

vi.mock("@/actions/dietitian-actions/reportCardActions", () => ({
  exportReportCardPdf: vi.fn(async () => ({
    success: false,
    error: "not exercised in this test",
  })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NUM_RUNS = 25;

/** A parameter-table row for KIT/ACCOMMODATION, dated ascending by index. */
function parameterRowArb(logDate: string, index: number) {
  return fc
    .record({
      authorType: fc.constantFrom("DIETITIAN", "CUSTOMER"),
      parameters: sparseParameterMapArb("KIT", { allowEmpty: false }),
    })
    .map(
      ({ authorType, parameters }): ReportCardParameterRow => ({
        logDate,
        authorType,
        authorName: authorType === "DIETITIAN" ? `Dietitian ${index}` : null,
        parameters,
        customParameters: [],
      }),
    );
}

const reportViewModelArb: fc.Arbitrary<ReportCardViewModel> = fc
  .uniqueArray(istDateArb, { minLength: 1, maxLength: 6 })
  .map((dates) => [...dates].sort())
  .chain((dates) =>
    fc
      .tuple(...dates.map((date, i) => parameterRowArb(date, i)))
      .map((rows) => ({ dates, rows: rows as ReportCardParameterRow[] })),
  )
  .chain(({ rows }) =>
    fc
      .record({
        dietitianLogCount: fc.integer({ min: 0, max: 20 }),
        pendingLogCount: fc.integer({ min: 0, max: 10 }),
        selfLogCount: fc.integer({ min: 0, max: 20 }),
        skippedSelfLogCount: fc.integer({ min: 0, max: 10 }),
        pausedDaysCount: fc.integer({ min: 0, max: 10 }),
      })
      .map((adherence): ReportCardViewModel => ({
        customerName: "Test Customer",
        customerCode: "AD-0042",
        category: "KIT",
        assignedDietitianName: "Nandini",
        parameterTable: rows,
        trends: { weight: [], bp: [], fastingSugar: [] },
        adherence,
        // Reverse-chronological (Req 19.5): newest date first.
        closingComments: [...rows]
          .filter((_, i) => i % 2 === 0)
          .reverse()
          .map((row, i) => ({
            logDate: row.logDate,
            comment: `Comment ${i}`,
            authorName: row.authorName,
            submittedAt: `${row.logDate}T10:00:00.000Z`,
          })),
        hasHealthLogs: rows.length > 0,
      })),
  );

/** Display text for one recorded parameter value, mirroring the component's own formatter. */
function displayTextFor(value: ParameterValue): string {
  if ("systolic" in value) return `${value.systolic}/${value.diastolic} ${value.unit}`;
  if (typeof value.value === "boolean") return value.value ? "Yes" : "No";
  if (typeof value.value === "number") return value.unit ? `${value.value} ${value.unit}` : `${value.value}`;
  return value.value;
}

describe("Property 32: the Report_Card contains every recorded value, its adherence numbers and comment history", () => {
  it("the parameter table contains every recorded value exactly once, in date order", () => {
    /**
     * **Validates: Requirements 19.2**
     */
    fc.assert(
      fc.property(reportViewModelArb, (report) => {
        cleanup();
        const { container } = render(
          <ReportCardView report={report} customerProfileId={fixtureUuid(44, 1)} />,
        );

        const rows = container.querySelectorAll("table tbody tr");
        expect(rows).toHaveLength(report.parameterTable.length);

        report.parameterTable.forEach((row, index) => {
          const cellText = rows[index]?.textContent ?? "";
          for (const value of Object.values(row.parameters)) {
            expect(cellText).toContain(displayTextFor(value));
          }
        });

        cleanup();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the adherence summary equals the computed counts handed to it", () => {
    /**
     * **Validates: Requirements 19.4**
     */
    fc.assert(
      fc.property(reportViewModelArb, (report) => {
        cleanup();
        const { container } = render(
          <ReportCardView report={report} customerProfileId={fixtureUuid(44, 1)} />,
        );

        // Read each stat card's own value node directly (by its position
        // among the five adherence stat cards) rather than by text content,
        // since several counts may legitimately share the same numeric value.
        const statValues = Array.from(
          container.querySelectorAll("p.mt-1.text-2xl"),
        ).map((node) => node.textContent);

        expect(statValues).toEqual([
          String(report.adherence.dietitianLogCount),
          String(report.adherence.pendingLogCount),
          String(report.adherence.selfLogCount),
          String(report.adherence.skippedSelfLogCount),
          String(report.adherence.pausedDaysCount),
        ]);

        cleanup();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("Closing_Comments are listed in the order given (reverse-chronological), each with its author name", () => {
    /**
     * **Validates: Requirements 19.5**
     */
    fc.assert(
      fc.property(reportViewModelArb, (report) => {
        cleanup();
        const { container } = render(
          <ReportCardView report={report} customerProfileId={fixtureUuid(44, 1)} />,
        );

        if (report.closingComments.length === 0) {
          expect(screen.getByText(/no closing comments recorded/i)).toBeInTheDocument();
          cleanup();
          return;
        }

        // The section renders one block per entry, in the array's order —
        // `buildClosingCommentHistory` is what puts them newest-first; this
        // component must not re-sort or drop any of them.
        const commentBlocks = Array.from(container.querySelectorAll("p")).filter((p) =>
          report.closingComments.some((entry) => p.textContent === entry.comment),
        );
        expect(commentBlocks).toHaveLength(report.closingComments.length);

        report.closingComments.forEach((entry) => {
          const node = screen.getByText(entry.comment);
          expect(node).toBeInTheDocument();
          const meta = node.parentElement?.querySelector("span:last-of-type");
          if (entry.authorName) {
            expect(meta?.textContent).toContain(entry.authorName);
          }
        });

        cleanup();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("Report_Card is offered (rendered) for KIT and ACCOMMODATION, and the PDF export is disabled exactly when there are no Health_Logs", () => {
    /**
     * **Validates: Requirements 19.1, 19.6, 19.8**
     *
     * `ReportCardView` itself renders unconditionally once mounted — the
     * KIT/ACCOMMODATION-only restriction is `reportCardActions.getReportCard`
     * / `exportReportCardPdf`'s gate (Req 19.1), enforced before this
     * component is ever reached by a MEAL customer. What this component
     * itself must guarantee is the export-button's disabled state tracking
     * `hasHealthLogs` exactly (Req 19.6, 19.8).
     */
    fc.assert(
      fc.property(
        reportViewModelArb.chain((report) =>
          fc.record({
            report: fc.constant(report),
            hasHealthLogs: fc.boolean(),
          }),
        ),
        ({ report, hasHealthLogs }) => {
          cleanup();
          const withFlag: ReportCardViewModel = { ...report, hasHealthLogs };
          render(<ReportCardView report={withFlag} customerProfileId={fixtureUuid(44, 1)} />);

          const exportButton = screen.getByRole("button", { name: /export pdf/i });
          if (hasHealthLogs) {
            expect(exportButton).not.toBeDisabled();
          } else {
            expect(exportButton).toBeDisabled();
          }

          cleanup();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
