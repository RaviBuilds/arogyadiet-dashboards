"use client";

// src/shared/components/rider/RiderForgotPasswordForm.tsx
// Visual-only redesign of the rider "forgot password" screen so it shares
// the same brand language (glass card, red/amber wash, icon-prefixed input)
// as RiderLoginForm — the login → forgot-password → back-to-login flow now
// reads as one cohesive product instead of switching styles mid-flow.
//
// UI/UX ONLY — uses the exact same `forgotPasswordAction` server action,
// same "email" field name/required validation, and the same success/error
// states as the shared `ForgotPasswordForm`
// (@/shared/components/forms/forget-password-form.tsx). No logic changed.

import { useActionState } from "react";
import Link from "next/link";
import { Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

import { forgotPasswordAction } from "@/actions/authActions";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/lib/utils";

export function RiderForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    forgotPasswordAction,
    null,
  );

  if (state?.success) {
    return (
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <Card className="relative overflow-hidden rounded-[28px] border border-white/60 bg-gradient-to-b from-white/90 to-white/75 py-0 text-center shadow-[0_40px_80px_-30px_rgba(120,30,20,0.35),0_8px_24px_-12px_rgba(120,30,20,0.18)] ring-1 ring-red-900/5 backdrop-blur-xl sm:rounded-[32px]">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-red-200/35 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-amber-100/45 blur-3xl" />

          <div className="relative px-7 pb-6 pt-9 sm:px-8">
            <div className="relative flex flex-col items-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-900/20 ring-1 ring-white/40">
                <CheckCircle2 className="h-7 w-7 text-white" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900">
                  Check your email
                </h1>
                <p className="text-[0.95rem] text-slate-500">{state.success}</p>
              </div>
            </div>
          </div>

          <CardContent className="relative px-7 pb-8 pt-2 sm:px-8">
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-[52px] w-full rounded-2xl border-2 border-red-900/10 text-base font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700"
            >
              <Link href="/login">Back to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-6">
      <Card className="relative overflow-hidden rounded-[28px] border border-white/60 bg-gradient-to-b from-white/90 to-white/75 py-0 shadow-[0_40px_80px_-30px_rgba(120,30,20,0.35),0_8px_24px_-12px_rgba(120,30,20,0.18)] ring-1 ring-red-900/5 backdrop-blur-xl sm:rounded-[32px]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-red-200/35 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-amber-100/45 blur-3xl" />

        <div className="relative px-7 pb-6 pt-9 sm:px-8">
          <div className="relative flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#e74c3c] to-[#c0392b] shadow-lg shadow-red-900/20 ring-1 ring-white/40">
              <Mail className="h-7 w-7 text-white" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900">
                Reset your password
              </h1>
              <p className="text-[0.95rem] text-slate-500">
                Enter your email address and we&apos;ll send you a reset link
              </p>
            </div>
          </div>
        </div>

        <CardContent className="relative space-y-6 px-7 pb-8 pt-2 sm:px-8">
          <form action={formAction} className="space-y-6">
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
                    Sending link...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </span>
            </Button>

            <p className="text-center text-sm text-slate-500">
              Remember your password?{" "}
              <Link
                href="/login"
                className="font-medium text-red-600 underline-offset-4 hover:underline"
              >
                Back to login
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
