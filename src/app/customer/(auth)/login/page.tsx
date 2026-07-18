// src/app/customer/(auth)/login/page.tsx
// Customer-portal login (customer-pin-auth, Task 6.5).
//
// RSC shell for the mobile-first PIN login. The interactive flow lives in the
// `CustomerLoginView` client leaf which manages toggling between the PIN login
// form and the "Set New PIN" form (for temp-PIN first-login flow).
// This screen deliberately does NOT use the shared `login-form.tsx` (still used
// by admin/rider/master/franchise), so it exposes no signup link, no "Login
// with Google" button, and no email/password fields (Req 1.1/1.2/1.3).
//
// Layout: premium split-screen on desktop/tablet — an emotional brand story on
// the left (LoginBrandPanel) and the login card on the right — collapsing to a
// single centered card on mobile. This is the first screen every customer
// sees, so it carries the full wellness-brand visual language (forest green →
// mint, organic patterns, soft glow) rather than a bare admin-style form.
// UI/UX ONLY — no auth, OTP, validation, API, or routing logic lives here.
//
// Requirements: 2.3, 2.7, 2.8, 2.9, 3.2

import Image from "next/image";
import { CustomerLoginView } from "./CustomerLoginView";
import { LoginBrandPanel } from "./LoginBrandPanel";

export default function CustomerLogin() {
  return (
    <div className="relative flex min-h-svh w-full overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 lg:flex-row lg:bg-none">
      <LoginBrandPanel />

      {/* ── Right pane: the login card ─────────────────────────────────── */}
      <div className="relative flex min-h-svh w-full flex-1 flex-col items-center justify-center overflow-hidden p-5 sm:p-6 lg:bg-gradient-to-b lg:from-emerald-50/60 lg:via-white lg:to-emerald-50/40">
        {/* Ambient background — wellness texture that gives the card something
            to sit against instead of blank whitespace. Stronger than before so
            it actually reads, but still soft enough never to fight the card. */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-emerald-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-80 w-80 rounded-full bg-amber-100/60 blur-3xl" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime-100/40 blur-3xl" />
        {/* Faint concentric halo directly behind the card to anchor it. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0)_70%)]" />

        <div className="reveal-rise relative z-10 flex w-full max-w-[400px] flex-col items-center gap-6">
          {/* Logo shown only on mobile/tablet, where the brand panel is
              hidden — kept close to the card so it never feels disconnected. */}
          <div className="flex flex-col items-center gap-1.5 lg:hidden">
            <Image
              src="/logo.png"
              alt="ArogyaDiet"
              width={170}
              height={57}
              priority
              className="h-auto w-[150px]"
            />
            <p className="text-xs font-medium tracking-wide text-emerald-700/70">
              Meals · Nutrition kits · Wellness stays
            </p>
          </div>

          <CustomerLoginView redirectPath="/dashboard" />
        </div>
      </div>
    </div>
  );
}
