// src/app/customer/(auth)/login/page.tsx
// Customer-portal login (customer-mobile-onboarding, Task 10.1).
//
// RSC shell for the mobile-first OTP login. The interactive flow lives in the
// `MobileOtpLoginForm` client leaf. This screen deliberately does NOT use the
// shared `login-form.tsx` (still used by admin/rider/master/franchise), so it
// exposes no signup link, no "Login with Google" button, and no email/password
// fields (Req 1.1/1.2/1.3). Mobile-first single-column ~360px layout
// (Req 15.1/15.4/15.5).

import Image from "next/image";
import { MobileOtpLoginForm } from "@/shared/components/customer/MobileOtpLoginForm";

export default function CustomerLogin() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 sm:p-6">
      <div className="flex w-full max-w-[360px] flex-col gap-6">
        <span className="flex items-center gap-2 self-center font-medium">
          <Image
            src="/logo.png"
            alt="Arogyadiet"
            width={180}
            height={60}
            priority
            className="h-auto w-auto"
          />
        </span>
        <MobileOtpLoginForm redirectPath="/dashboard" />
      </div>
    </div>
  );
}
