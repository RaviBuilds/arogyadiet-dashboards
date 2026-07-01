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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
