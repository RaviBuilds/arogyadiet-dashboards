import { RiderForgotPasswordForm } from "@/shared/components/rider/RiderForgotPasswordForm";

export default function RiderForgotPasswordPage() {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-gradient-to-br from-red-50/60 via-white to-amber-50/50 p-5 sm:p-6">
      {/* Same ambient wash as the rider login screen, so the login →
          forgot-password → back-to-login flow reads as one continuous
          product instead of switching visual styles mid-flow. */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-red-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-80 w-80 rounded-full bg-amber-100/50 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0)_70%)]" />

      <div className="relative z-10 flex w-full max-w-[400px] flex-col items-center gap-6">
        <RiderForgotPasswordForm />
      </div>
    </div>
  );
}
