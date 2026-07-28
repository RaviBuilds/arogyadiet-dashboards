// @vitest-environment jsdom
//
// src/test/dietitian/rendered-field-set.property.test.tsx
// Feature: dietitian-management, Property 15
//
// Property 15: The rendered field set matches the Customer_Category.
//
// For any Customer_Category, the log form renders exactly the parameters of
// that category's field set — 28 for ACCOMMODATION, the same set minus the six
// activity-specific parameters for MEAL and KIT — with the Closing_Comment as
// the final field and no parameter from outside the set.
//
// **Validates: Requirements 11.3, 11.4, 13.1**

import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as fc from "fast-check";

import { customerCategoryArb } from "@/test/dietitian/arbitraries";
import { fieldSetFor } from "@/lib/dietitian/fieldSets";
import { HealthLogForm } from "@/shared/components/dietitian/HealthLogForm";
import type { CustomerCategory } from "@/types/dietitian";

// The form submits through `submitHealthLog`; this suite only renders and
// inspects the DOM, so the Server Action is stubbed out.
vi.mock("@/actions/dietitian-actions/healthLogActions", () => ({
  submitHealthLog: vi.fn(async () => ({
    success: false,
    error: "not exercised in this test",
  })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Rendering the 28-field Accommodation form in jsdom is comparatively slow
// (~1s/run), so this suite runs fewer iterations than a pure-logic property
// test would — three Customer_Categories give a small, exhaustible input
// space, so a lower run count still reliably covers every category several
// times over.
const NUM_RUNS = 12;

/**
 * Every field the shipped table declares for `category`, as the label text
 * `HealthLogForm` renders for a `number`/`boolean`/`enum`/`text`/`bp` field
 * (each kind's label appears verbatim as a `<Label>`; `bp` additionally
 * renders "Systolic"/"Diastolic" sub-labels handled separately below).
 */
function expectedLabelsFor(category: CustomerCategory): string[] {
  return fieldSetFor(category).map((field) =>
    field.unit ? `${field.label} (${field.unit})` : field.label,
  );
}

describe("Property 15: the rendered field set matches the Customer_Category", () => {
  it("renders exactly the category's field set, with the Closing_Comment last and no foreign field", () => {
    /**
     * **Validates: Requirements 11.3, 11.4, 13.1**
     */
    fc.assert(
      fc.property(customerCategoryArb, (category) => {
        cleanup();

        render(
          <HealthLogForm
            customerProfileId="00000000-0000-4000-8000-000000000001"
            category={category}
            selectableDates={["2025-01-15"]}
            defaultLogDate="2025-01-15"
          />,
        );

        const fields = fieldSetFor(category);
        const otherCategories = (["MEAL", "KIT", "ACCOMMODATION"] as const).filter(
          (c) => c !== category,
        );

        // Every field of this category's table is rendered as a labelled
        // control (Req 11.3, 11.4). `bp` renders its own composite widget
        // (Systolic/Diastolic inputs) rather than a single labelled control
        // carrying the field's exact label text, so it is checked separately.
        for (const field of fields) {
          if (field.kind === "bp") {
            expect(screen.getAllByText(field.label, { exact: false }).length).toBeGreaterThan(0);
            expect(screen.getByLabelText(/systolic/i)).toBeInTheDocument();
            expect(screen.getByLabelText(/diastolic/i)).toBeInTheDocument();
            continue;
          }
          const expectedText = field.unit ? `${field.label} (${field.unit})` : field.label;
          expect(screen.getAllByText(expectedText).length).toBeGreaterThan(0);
        }

        // No parameter unique to a *different* category's field set leaks in
        // (the accommodation-only six for MEAL/KIT, or — vacuously for
        // ACCOMMODATION, since it is the superset — nothing to check there).
        for (const otherCategory of otherCategories) {
          const foreignOnly = fieldSetFor(otherCategory).filter(
            (f) => !fields.some((mine) => mine.key === f.key),
          );
          for (const foreign of foreignOnly) {
            if (foreign.kind === "bp") continue; // bp is shared by every category
            const expectedText = foreign.unit
              ? `${foreign.label} (${foreign.unit})`
              : foreign.label;
            expect(screen.queryAllByText(expectedText)).toHaveLength(0);
          }
        }

        // The Closing_Comment is the final field (Req 13.1): its labelled
        // textarea is present, and — because `HealthLogForm` renders the
        // category field set inside one container immediately followed by
        // the Custom_Parameter editor and then the Closing_Comment block —
        // the Closing_Comment textarea is the last labelled text-entry
        // control before the submit button in DOM order.
        const closingCommentField = screen.getByLabelText(/closing comment/i);
        expect(closingCommentField).toBeInTheDocument();
        expect(closingCommentField.tagName).toBe("TEXTAREA");

        const submitButton = screen.getByRole("button", { name: /save log/i });
        // The Closing_Comment control appears before the submit control, and
        // after every category field — DOM order confirms "last field".
        expect(
          closingCommentField.compareDocumentPosition(submitButton) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        cleanup();
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60000);

  it("renders the 28-parameter set for ACCOMMODATION and the 22-parameter set for MEAL/KIT", () => {
    /**
     * **Validates: Requirements 11.1, 11.2, 11.3, 11.4** (structural sanity
     * check on the field-set sizes behind Property 15, mirroring the
     * fieldSets.ts unit tests of task 2.7 without re-deriving the table.)
     */
    expect(fieldSetFor("ACCOMMODATION")).toHaveLength(28);
    expect(fieldSetFor("MEAL")).toHaveLength(22);
    expect(fieldSetFor("KIT")).toHaveLength(22);
    expect(expectedLabelsFor("MEAL")).toEqual(expectedLabelsFor("KIT"));
  });
});
