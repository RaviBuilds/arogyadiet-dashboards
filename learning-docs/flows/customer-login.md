# Flow: Customer Login (mobile + PIN)

Files in order: `src/app/customer/(auth)/login/page.tsx` → `CustomerLoginView.tsx` → `src/shared/components/customer/MobilePinLoginForm.tsx` → `src/actions/pinAuthActions.ts` → `src/services/EligibilityChecker.ts` → `src/repositories/customerOnboardingRepository.ts` → `src/services/PinThrottleService.ts` → `src/services/PinService.ts` → Supabase Auth `signInWithPassword` → `src/middleware.ts` (customer branch) → `src/app/customer/(main)/layout.tsx` → `src/lib/customer/get-session.ts`.

```mermaid
sequenceDiagram
  autonumber
  actor C as Customer
  participant F as MobilePinLoginForm (client)
  participant A as pinAuthActions.ts
  participant E as EligibilityChecker
  participant T as PinThrottleService (otp_login_throttle)
  participant P as PinService (users.pin_hash)
  participant SB as Supabase Auth
  participant MW as middleware.ts
  C->>F: enter mobile
  F->>A: checkEligibilityAction(mobile)
  A->>A: normalizeMobile
  A->>E: check(normalized)
  E-->>A: eligible (exactly one CUSTOMER, IN_PROGRESS/COMPLETED)
  A-->>F: ELIGIBLE (else "please contact admin")
  C->>F: enter 6-digit PIN
  F->>A: verifyPinAction(mobile, pin)
  A->>T: checkThrottle
  A->>P: verifyPin (bcrypt.compare)
  alt wrong PIN
    A->>T: incrementFailure (5 -> lock 15 min)
    A-->>F: INVALID / LOCKED
  else temp PIN
    A-->>F: TEMP_PIN -> SetNewPinForm
    F->>A: setPermanentPinAction(mobile, new, confirm)
    A->>P: setPermanentPin
    A->>SB: signInWithPassword(email, CUSTOMER_SERVER_PASSWORD)
  else correct permanent PIN
    A->>SB: signInWithPassword(email, CUSTOMER_SERVER_PASSWORD)
    A->>T: resetThrottle
  end
  SB-->>A: session cookies set on response
  F->>MW: navigate /dashboard
  MW->>MW: getUser, role CUSTOMER, one allowed record, category header, identity headers
  MW->>MW: /login while logged in -> redirect landing route
```

Step notes:
1. Eligibility never reveals why a number is rejected (same message for not registered / bad status / ambiguous).
2. The email used for sign-in may be a placeholder (`m<mobile>@placeholder.arogyadiet.internal`).
3. Throttle is per mobile in `otp_login_throttle` (RLS on, no policies → service role only).
4. Middleware then lets the user through only if `roles.code = CUSTOMER` and exactly one `customer_profiles` row is IN_PROGRESS/COMPLETED.

Known issues: `setPermanentPinAction` lacks a temp-PIN proof check; middleware `isTempPin` guard is dead code. See `16-known-issues-and-tech-debt.md`.
