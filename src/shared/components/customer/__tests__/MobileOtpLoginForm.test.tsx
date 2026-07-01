// @vitest-environment jsdom

// src/shared/components/customer/__tests__/MobileOtpLoginForm.test.tsx
//
// Component tests for the customer mobile-first login (Task 11.3).
//
// Covers:
//   Req 1.1 — no self-service signup entry point on the login screen.
//   Req 1.2 — no "Login with Google" / third-party OAuth control.
//   Req 1.3 — only the mobile-number control; no email/password fields.
//   Req 2.1 — a single mobile field is the only initial credential input; no
//             OTP field is visible until the mobile number is submitted.
//   Req 15.1/15.5 — mobile-first single-column layout capped at ~360px.
//   Req 15.7/15.9 — disabled/loading states on the submit control.
//
// The server actions and next/navigation are mocked so the leaf renders in
// isolation.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks ------------------------------------------------------------------
const requestOtpAction = vi.fn();
const resendOtpAction = vi.fn();
const verifyOtpAction = vi.fn();

vi.mock("@/actions/mobileAuthActions", () => ({
  requestOtpAction: (...args: unknown[]) => requestOtpAction(...args),
  resendOtpAction: (...args: unknown[]) => resendOtpAction(...args),
  verifyOtpAction: (...args: unknown[]) => verifyOtpAction(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { MobileOtpLoginForm } from "@/shared/components/customer/MobileOtpLoginForm";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MobileOtpLoginForm — login screen composition (Req 1.1–1.3, 2.1)", () => {
  it("renders exactly one text-like credential input, the mobile field (Req 1.3, 2.1)", () => {
    render(<MobileOtpLoginForm />);

    const mobile = screen.getByLabelText(/mobile number/i);
    expect(mobile).toBeInTheDocument();
    expect(mobile).toHaveAttribute("type", "tel");

    // No OTP/verification-code field is visible before the mobile is submitted.
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
  });

  it("shows no self-service signup entry point (Req 1.1)", () => {
    render(<MobileOtpLoginForm />);
    // No signup/register/create-account affordance of any kind.
    expect(
      screen.queryByRole("link", { name: /sign ?up|register|create account/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign ?up|register|create account/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
  });

  it("shows no Google / third-party OAuth control (Req 1.2)", () => {
    render(<MobileOtpLoginForm />);
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /google|continue with|sign in with/i }),
    ).not.toBeInTheDocument();
  });

  it("shows no email or password fields (Req 1.3)", () => {
    const { container } = render(<MobileOtpLoginForm />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('input[type="email"]')).toBeNull();
  });
});

describe("MobileOtpLoginForm — layout & control states (Req 15.1/15.5/15.7/15.9)", () => {
  it("uses a single-column layout capped at ~360px (Req 15.1/15.5)", () => {
    const { container } = render(<MobileOtpLoginForm />);
    // The root wrapper is a flex column constrained to max-w-[360px].
    const root = container.querySelector(".max-w-\\[360px\\]");
    expect(root).not.toBeNull();
    expect(root?.className).toContain("flex-col");
  });

  it("disables the Next button until a mobile number is entered (Req 15.7/15.9)", async () => {
    const user = userEvent.setup();
    render(<MobileOtpLoginForm />);

    const next = screen.getByRole("button", { name: /next/i });
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText(/mobile number/i), "9876543210");
    expect(next).toBeEnabled();
  });

  it("reveals the OTP entry step only after a successful send (Req 2.1)", async () => {
    requestOtpAction.mockResolvedValue({ outcome: "SENT" });
    const user = userEvent.setup();
    render(<MobileOtpLoginForm />);

    await user.type(screen.getByLabelText(/mobile number/i), "9876543210");
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(requestOtpAction).toHaveBeenCalledWith("9876543210");
    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
  });
});
