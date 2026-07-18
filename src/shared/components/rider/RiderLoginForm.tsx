"use client";

// src/shared/components/rider/RiderLoginForm.tsx
// Premium visual redesign of the Delivery Partner (rider) login screen.
//
// UI/UX ONLY — this is a presentational wrapper around the exact same
// server action, field names, and control flow as the shared
// `LoginForm` (@/shared/components/forms/login-form.tsx):
//   - same `LoginAction` server action via useActionState
//   - same hidden `portalRole` / `redirectPath` fields
//   - same "email" / "password" field names, same `required` validation
//   - same forgot-password link target ("forgot-password")
//   - same pending / error states
//
// No auth, validation, routing, or business logic was added, removed, or
// changed. Only markup, classNames, and purely-decorative elements differ
// from the shared form.
//
// Brand alignment: colors are pulled directly from the app's design tokens
// (--primary #e74c3c red, --accent #5d4037 warm brown) rather than an
// off-brand slate/black palette, so this reads as "ArogyaDiet, for riders"
// rather than a different product.

import { useActionState, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Lock,
  AlertCircle,
  Bike,
  ShieldCheck,
  Navigation,
  Wallet,
} from "lucide-react";

import { LoginAction } from "@/actions/authActions";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/lib/utils";

interface RiderLoginFormProps {
  portalRole?: string;
  redirectPath?: string;
  formTitle?: string;
}

export function RiderLoginForm({
  portalRole = "RIDER",
  redirectPath = "/dashboard",
  formTitle = "Delivery Partner Portal",
}: RiderLoginFormProps) {
  const [state, formAction, isPending] = useActionState(LoginAction, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-6">
      <Card className="relative overflow-hidden rounded-[28px] border border-white/60 bg-gradient-to-b from-white/90 to-white/75 py-0 shadow-[0_40px_80px_-30px_rgba(120,30,20,0.35),0_8px_24px_-12px_rgba(120,30,20,0.18)] ring-1 ring-red-900/5 backdrop-blur-xl sm:rounded-[32px]">
        {/* Single continuous brand wash — warm red/amber, on-brand with
            --primary, distinct in mood from the customer portal's calmer
            green without ever feeling like a different product. */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-red-200/35 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-amber-100/45 blur-3xl" />

        {/* Hero — single cohesive brand mark (logo + role badge) instead of
            two disconnected boxes. */}
        <div className="relative px-7 pb-6 pt-9 sm:px-8">
          <div className="relative flex flex-col items-center gap-4 text-center">
            <RiderBrandMark />
            <div className="space-y-1.5">
              <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900">
                {formTitle}
              </h1>
              <p className="text-[0.95rem] text-slate-500">
                Sign in to manage your deliveries
              </p>
            </div>
          </div>
        </div>

        <CardContent className="relative space-y-6 px-7 pb-8 pt-2 sm:px-8">
          <form action={formAction} className="space-y-6">
            <input type="hidden" name="portalRole" value={portalRole} />
            <input type="hidden" name="redirectPath" value={redirectPath} />

            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-slate-600"
                >
                  Email
                </label>
                <div className="relative flex items-center overflow-hidden rounded-2xl border-2 border-red-900/10 bg-white shadow-sm transition-all duration-300 focus-within:border-red-400 focus-within:shadow-[0_0_0_4px_rgba(231,76,60,0.12)]">
                  <span
                    aria-hidden="true"
                    className="flex h-12 shrink-0 items-center pl-4 text-red-400/70"
                  >
                    <Mail className="h-4 w-4" />
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                    disabled={isPending}
                    className="h-12 w-full min-w-0 flex-1 bg-transparent px-3 text-[0.95rem] font-medium text-slate-900 outline-none autofill:shadow-[inset_0_0_0px_1000px_white] placeholder:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-slate-600"
                  >
                    Password
                  </label>
                  <Link
                    href="forgot-password"
                    className="text-sm font-medium text-red-600/80 underline-offset-4 transition-colors hover:text-red-700 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <div className="relative flex items-center overflow-hidden rounded-2xl border-2 border-red-900/10 bg-white shadow-sm transition-all duration-300 focus-within:border-red-400 focus-within:shadow-[0_0_0_4px_rgba(231,76,60,0.12)]">
                  <span
                    aria-hidden="true"
                    className="flex h-12 shrink-0 items-center pl-4 text-red-400/70"
                  >
                    <Lock className="h-4 w-4" />
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    disabled={isPending}
                    className="h-12 w-full min-w-0 flex-1 bg-transparent px-3 text-[0.95rem] font-medium text-slate-900 outline-none autofill:shadow-[inset_0_0_0px_1000px_white] placeholder:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <button
                    type="button"
                    className="flex h-12 shrink-0 items-center pr-4 text-slate-400 transition-colors hover:text-red-600"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {state?.error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-left text-sm font-medium text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{state.error}</span>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={isPending}
              className={cn(
                "group/cta relative h-[52px] w-full overflow-hidden rounded-2xl text-base font-semibold text-white transition-all duration-200",
                "bg-gradient-to-br from-[#f0685a] via-[#e74c3c] to-[#c0392b] shadow-lg shadow-red-900/30",
                "hover:-translate-y-0.5 hover:shadow-xl hover:shadow-red-900/40 active:translate-y-0",
                "disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
              )}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent"
              />
              <span className="relative flex items-center justify-center">
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                    Logging in...
                  </>
                ) : (
                  "Login"
                )}
              </span>
            </Button>

            <RiderTrustStrip />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * RiderBrandMark — one cohesive hero mark instead of a floating logo box
 * plus a separate generic icon. Uses `object-contain` (never `object-cover`)
 * so the wordmark logo is always shown in full, never cropped, regardless
 * of its native aspect ratio. The bike badge sits fully outside the logo's
 * padded frame — not layered on top of it — so it never obscures any part
 * of the wordmark while still reading as one connected mark.
 */
function RiderBrandMark() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 scale-125 rounded-[22px] bg-red-400/20 blur-xl"
      />
      <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-[22px] bg-white p-2 shadow-[0_12px_30px_-10px_rgba(120,30,20,0.4)] ring-1 ring-white/70">
        <Image
          src="/Logo-arogya.jpeg"
          alt="ArogyaDiet"
          width={72}
          height={72}
          priority
          className="h-full w-full object-contain"
        />
      </div>
      <div className="absolute -bottom-2.5 -right-2.5 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#e74c3c] to-[#c0392b] shadow-md shadow-red-900/30 ring-2 ring-white">
        <Bike className="h-3.5 w-3.5 text-white" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * RiderTrustStrip — mirrors the customer portal's trust row so the two
 * login screens feel like siblings, with rider-relevant, non-invented
 * signals (this app already does secure auth + live route tracking).
 */
function RiderTrustStrip() {
  const items = [
    { icon: ShieldCheck, label: "Secure login" },
    { icon: Navigation, label: "Live route sync" },
    { icon: Wallet, label: "Earnings protected" },
  ];

  return (
    <div className="flex items-center justify-center gap-3 pt-1 sm:gap-5">
      {items.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="flex items-center gap-1.5 whitespace-nowrap text-[0.7rem] font-medium text-slate-500 sm:text-xs"
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
