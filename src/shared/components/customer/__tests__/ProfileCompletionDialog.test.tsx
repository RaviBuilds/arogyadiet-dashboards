// @vitest-environment jsdom

// src/shared/components/customer/__tests__/ProfileCompletionDialog.test.tsx
//
// Component tests for the profile-completion dialog (Task 11.3).
//
//   Req 9.2  — every displayed field is optional (a zero-field "Save" is
//              accepted and submits an empty patch).
//   Req 10.5 — WHERE the current email is a Test_Email, a real-email input is
//              offered; otherwise it is absent.
//
// Server actions, next/navigation and sonner are mocked so the dialog renders
// and submits in isolation.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fc from "fast-check";

const saveProfileCompletionAction = vi.fn();
const markOnboardingCompletedAction = vi.fn();

vi.mock("@/actions/profileCompletionActions", () => ({
  saveProfileCompletionAction: (...a: unknown[]) => saveProfileCompletionAction(...a),
  markOnboardingCompletedAction: (...a: unknown[]) => markOnboardingCompletedAction(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProfileCompletionDialog } from "@/shared/components/customer/ProfileCompletionDialog";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileCompletionDialog — real-email input (Req 10.5)", () => {
  it("offers a real-email input when the current email is a Test_Email", () => {
    render(<ProfileCompletionDialog isTestEmail />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("omits the real-email input when the email is not a Test_Email", () => {
    render(<ProfileCompletionDialog isTestEmail={false} />);
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });
});

describe("ProfileCompletionDialog — optional fields (Req 9.2)", () => {
  it("accepts a zero-field Save and submits an empty patch", async () => {
    saveProfileCompletionAction.mockResolvedValue({ success: true, completed: false });
    const user = userEvent.setup();

    render(<ProfileCompletionDialog isTestEmail={false} />);

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(saveProfileCompletionAction).toHaveBeenCalledTimes(1);
    // Nothing filled in → an empty payload (all fields optional).
    expect(saveProfileCompletionAction).toHaveBeenCalledWith({});
  });

  it("allows completing onboarding with no fields provided (Req 9.2/9.4)", async () => {
    markOnboardingCompletedAction.mockResolvedValue({ success: true, completed: true });
    const user = userEvent.setup();

    render(<ProfileCompletionDialog isTestEmail={false} />);

    await user.click(
      screen.getByRole("button", { name: /mark completed onboarding/i }),
    );

    expect(markOnboardingCompletedAction).toHaveBeenCalledWith({});
  });
});

// ---------------------------------------------------------------------------
// Feature: mandatory-profile-completion-popup, Property 4:
//   Medical document selection enforces type, size, and count limits.
//
//   For any list of selected files with varied MIME types and sizes, the
//   resulting accepted set contains only image or PDF files each no larger
//   than 10 MB, and never exceeds 5 files total; whenever a file is rejected
//   for an unsupported type, for exceeding 10 MB, or for exceeding the 5-file
//   cap, a descriptive error message is produced.
//
// Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
//
// The dialog is rendered with a mandatory category (MEAL) so the inline medical
// document upload control is present, then `handleDocumentSelect` is exercised
// through the real file input via Testing Library. `applyAccept: false` lets
// unsupported types reach the handler (the browser's own accept filtering is
// not the behavior under test). File sizes are overridden so the 10MB boundary
// can be probed without allocating large buffers.
// ---------------------------------------------------------------------------
describe("ProfileCompletionDialog — medical document selection limits (Property 4)", () => {
  const MAX_FILES = 5;
  const MAX_BYTES = 10 * 1024 * 1024;

  const VALID_TYPES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
  ];
  const INVALID_TYPES = [
    "text/plain",
    "application/msword",
    "video/mp4",
    "application/json",
    "application/octet-stream",
    "", // a File with no MIME type is not an image or PDF
  ];

  function makeFile(name: string, type: string, size: number): File {
    const file = new File(["x"], name, { type });
    // Shadow the read-only `size` getter so large sizes need no real bytes.
    Object.defineProperty(file, "size", { value: size, configurable: true });
    return file;
  }

  function isAcceptedType(type: string): boolean {
    return type.startsWith("image/") || type === "application/pdf";
  }

  // Oracle mirroring `handleDocumentSelect` for a single batch appended to an
  // initially-empty selection.
  function expected(
    specs: Array<{ name: string; type: string; size: number }>,
  ): { accepted: string[]; error: boolean } {
    // Count cap is checked against the whole selected batch first: exceeding it
    // rejects every file in the batch (Req 3.3 / 3.7).
    if (specs.length > MAX_FILES) return { accepted: [], error: true };

    const accepted: string[] = [];
    let error = false;
    for (const s of specs) {
      if (!isAcceptedType(s.type)) {
        error = true; // Req 3.2 / 3.5
        continue;
      }
      if (s.size > MAX_BYTES) {
        error = true; // Req 3.4 / 3.6
        continue;
      }
      accepted.push(s.name);
    }
    return { accepted, error };
  }

  const specArb = fc.record({
    type: fc.constantFrom(...VALID_TYPES, ...INVALID_TYPES),
    // Sizes deliberately cluster around the 10MB boundary as well as spanning a
    // broad range so both accept and reject paths are exercised.
    size: fc.oneof(
      fc.integer({ min: 0, max: MAX_BYTES }),
      fc.integer({ min: MAX_BYTES, max: 2 * MAX_BYTES }),
      fc.constantFrom(0, MAX_BYTES - 1, MAX_BYTES, MAX_BYTES + 1),
    ),
  });

  it("accepts only image/PDF files ≤10MB, caps the set at 5, and reports rejections", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 1..8 files exercises both the per-file rules and the >5 count cap.
        fc.array(specArb, { minLength: 1, maxLength: 8 }),
        async (rawSpecs) => {
          const specs = rawSpecs.map((s, i) => ({
            ...s,
            name: `doc-${i}.bin`,
          }));
          const files = specs.map((s) => makeFile(s.name, s.type, s.size));
          const model = expected(specs);

          const user = userEvent.setup({ applyAccept: false });
          try {
            render(
              <ProfileCompletionDialog
                customerCategory="MEAL"
                isTestEmail={false}
              />,
            );

            const input = screen.getByLabelText(/medical documents/i);
            await user.upload(input, files);

            // Invariant on the accepted set (Req 3.2, 3.3, 3.4).
            expect(model.accepted.length).toBeLessThanOrEqual(MAX_FILES);
            for (const s of specs) {
              if (model.accepted.includes(s.name)) {
                expect(isAcceptedType(s.type)).toBe(true);
                expect(s.size).toBeLessThanOrEqual(MAX_BYTES);
              }
            }

            // The component's rendered selection matches the model exactly:
            // accepted files are listed, rejected files are not.
            for (const s of specs) {
              if (model.accepted.includes(s.name)) {
                expect(screen.getByText(s.name)).toBeInTheDocument();
              } else {
                expect(screen.queryByText(s.name)).not.toBeInTheDocument();
              }
            }

            // A descriptive error message appears iff at least one file was
            // rejected (Req 3.5, 3.6, 3.7).
            const errorEl = screen.queryByText(
              /must be an image or PDF file|exceeds the 10MB limit|maximum of 5 documents/i,
            );
            if (model.error) {
              expect(errorEl).toBeInTheDocument();
            } else {
              expect(errorEl).not.toBeInTheDocument();
            }
          } finally {
            // fast-check runs many iterations inside a single test; the global
            // afterEach cleanup only fires once, so unmount each render here.
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Feature: mandatory-profile-completion-popup, Task 4.5:
//   Component tests for MEAL/KIT mandatory-completion behavior.
//
//   Req 1.2/1.3 — "Mark completed onboarding" stays disabled until the medical
//                 history notes have non-whitespace content OR the "no medical
//                 history" confirmation checkbox is checked.
//   Req 3.1     — the inline medical document upload control is present for
//                 MEAL/KIT customers.
//   Req 2.2/6.1 — no "Skip for now" button is rendered; the Dialog's built-in
//                 close control is the temporary skip mechanism instead.
//   Req 3.5-3.7 — descriptive file-validation error messages are shown for an
//                 unsupported file type and an oversized (>10MB) file.
//
// These are example-based (non-property) assertions rendered with a mandatory
// category (MEAL, plus a KIT variant) so the mandatory-completion branch of the
// shared dialog is exercised in isolation.
// ---------------------------------------------------------------------------
describe("ProfileCompletionDialog — MEAL/KIT mandatory behavior (Task 4.5)", () => {
  const MAX_BYTES = 10 * 1024 * 1024;

  function makeFile(name: string, type: string, size: number): File {
    const file = new File(["x"], name, { type });
    // Shadow the read-only `size` getter so large sizes need no real bytes.
    Object.defineProperty(file, "size", { value: size, configurable: true });
    return file;
  }

  const completeButton = () =>
    screen.getByRole("button", { name: /mark completed onboarding/i });

  // -- Req 1.2/1.3: complete button gated on notes OR confirmation ----------

  it("disables the complete button when notes are empty and the checkbox is unchecked (Req 1.3)", () => {
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    const button = completeButton();
    expect(button).toBeDisabled();
    // Disabled state is conveyed to assistive technologies (Req 6.3).
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the complete button disabled for whitespace-only notes (Req 1.3)", async () => {
    const user = userEvent.setup();
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    await user.type(screen.getByLabelText(/medical history notes/i), "   ");

    expect(completeButton()).toBeDisabled();
  });

  it("enables the complete button after non-whitespace notes are entered (Req 1.2)", async () => {
    const user = userEvent.setup();
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    expect(completeButton()).toBeDisabled();

    await user.type(
      screen.getByLabelText(/medical history notes/i),
      "Type 2 diabetes",
    );

    expect(completeButton()).toBeEnabled();
    expect(completeButton()).toHaveAttribute("aria-disabled", "false");
  });

  it("enables the complete button after the 'no medical history' checkbox is checked (Req 1.2)", async () => {
    const user = userEvent.setup();
    render(<ProfileCompletionDialog customerCategory="KIT" isTestEmail={false} />);

    expect(completeButton()).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));

    expect(completeButton()).toBeEnabled();
  });

  // -- Req 3.1: inline upload control present for MEAL/KIT -------------------

  it("renders the medical document upload control for MEAL customers (Req 3.1)", () => {
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    expect(screen.getByLabelText(/medical documents/i)).toBeInTheDocument();
  });

  it("renders the medical document upload control for KIT customers (Req 3.1)", () => {
    render(<ProfileCompletionDialog customerCategory="KIT" isTestEmail={false} />);

    expect(screen.getByLabelText(/medical documents/i)).toBeInTheDocument();
  });

  // -- Req 2.2/6.1: no "Skip for now" button --------------------------------

  it("does not render a 'Skip for now' button for MEAL customers (Req 2.2/6.1)", () => {
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    expect(
      screen.queryByRole("button", { name: /skip for now/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render a 'Skip for now' button for KIT customers (Req 2.2/6.1)", () => {
    render(<ProfileCompletionDialog customerCategory="KIT" isTestEmail={false} />);

    expect(
      screen.queryByRole("button", { name: /skip for now/i }),
    ).not.toBeInTheDocument();
  });

  // -- Req 3.5-3.7: descriptive file-validation error messages --------------

  it("shows a descriptive error when an unsupported file type is selected (Req 3.5)", async () => {
    // applyAccept:false lets the unsupported type reach handleDocumentSelect
    // (the browser's own accept filtering is not the behavior under test).
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    await user.upload(
      screen.getByLabelText(/medical documents/i),
      makeFile("notes.txt", "text/plain", 1024),
    );

    expect(
      screen.getByText(/notes\.txt must be an image or PDF file\./i),
    ).toBeInTheDocument();
    // The rejected file is not added to the selection.
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("shows a descriptive error when a file larger than 10MB is selected (Req 3.6)", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    await user.upload(
      screen.getByLabelText(/medical documents/i),
      makeFile("scan.pdf", "application/pdf", MAX_BYTES + 1),
    );

    expect(
      screen.getByText(/scan\.pdf exceeds the 10MB limit\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText("scan.pdf")).not.toBeInTheDocument();
  });

  it("shows a descriptive error when more than 5 files are attached (Req 3.7)", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    const files = Array.from({ length: 6 }, (_, i) =>
      makeFile(`doc-${i}.pdf`, "application/pdf", 1024),
    );

    await user.upload(screen.getByLabelText(/medical documents/i), files);

    expect(
      screen.getByText(/maximum of 5 documents\./i),
    ).toBeInTheDocument();
  });

  it("accepts a valid image/PDF file and lists it in the selection (Req 3.1)", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfileCompletionDialog customerCategory="MEAL" isTestEmail={false} />);

    await user.upload(
      screen.getByLabelText(/medical documents/i),
      makeFile("report.png", "image/png", 2048),
    );

    expect(screen.getByText("report.png")).toBeInTheDocument();
    expect(
      screen.queryByText(
        /must be an image or PDF file|exceeds the 10MB limit|maximum of 5 documents/i,
      ),
    ).not.toBeInTheDocument();
  });
});
