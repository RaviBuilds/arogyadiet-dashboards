# Implementation Plan: Customer Mobile Onboarding

## Overview

This plan converts the ArogyaDiet customer experience to a mobile-first, admin-initiated onboarding model. It is built bottom-up so each step is verifiable in isolation before it is wired together: additive Supabase migrations first, then pure decision logic (`src/lib`) and Zod schemas, then the data-access layer (`src/repositories`), then business services (`src/services`), then the server actions that orchestrate them, and finally the admin and customer UI that consume the actions. Each property from the design is implemented as its own `fast-check` property test placed next to the logic it validates so errors surface early.

Implementation language is **TypeScript** on **Next.js 16 (App Router)**, per the design and steering. Consult `node_modules/next/dist/docs/` before writing any route or server-action code, since this Next.js version has breaking changes. Tests run with `npm run test` (vitest run); lint with `npm run lint`.

## Tasks

- [x] 1. Database migrations (additive, idempotent, with rollback headers)
  - [x] 1.1 Add `onboarding_status` to `customer_profiles`
    - Create `scripts/add-onboarding-status-to-customer-profiles.sql`: `ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'IN_PROGRESS'`, CHECK constraint `IN ('IN_PROGRESS','COMPLETED')`, and index `(onboarding_status, franchise_id)`
    - Include a data step back-filling pre-existing legacy customers to `COMPLETED`; include rollback (drop index, constraint, column)
    - _Requirements: 6.9, 6.10, 14.1, 14.2_

  - [x] 1.2 Add `customer_category` to `subscriptions`
    - Create `scripts/add-customer-category-to-subscriptions.sql`: `ADD COLUMN IF NOT EXISTS customer_category TEXT NOT NULL DEFAULT 'MEAL'`, CHECK `IN ('MEAL','KIT','ACCOMMODATION')`, and partial unique index `uq_active_subscription_per_category` on `(customer_profile_id, customer_category) WHERE status IN ('PENDING','ACTIVE')`
    - Include rollback (drop index, constraint, column)
    - _Requirements: 13.1, 13.11_

  - [x] 1.3 Add `is_test_email` flag to `users`
    - Create `scripts/add-test-email-flag-to-users.sql`: `ADD COLUMN IF NOT EXISTS is_test_email BOOLEAN NOT NULL DEFAULT false`; keep `email` NOT NULL + UNIQUE (no constraint drop)
    - Include rollback (drop column)
    - _Requirements: 10.1, 10.3, 14.4_

  - [x] 1.4 Create `otp_login_throttle` table
    - Create `scripts/create-otp-login-throttle-table.sql` keyed by normalized `mobile` with `window_started_at`, `failed_attempts`, `resend_count`, `last_sent_at`, `locked_until`, `updated_at`
    - Enable RLS with no anon/customer policies (service-role only); include rollback (drop table)
    - _Requirements: 2.5, 2.7, 2.9, 2.10_

  - [x] 1.5 Create `onboard_customer` atomic RPC
    - Create `scripts/create-onboard-customer-rpc.sql`: `SECURITY DEFINER` PL/pgSQL function taking a JSONB payload that inserts `users`, `customer_profiles` (`IN_PROGRESS`), `subscriptions` (`customer_category`, `starts_on`), `payments` (`PAID`, amount, `paid_at`), and primary `addresses` (`is_primary=true`) in one transaction, returning created ids and rolling back on any failure
    - Include rollback (drop function)
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 5.5, 8.3, 8.6_

- [x] 2. Checkpoint - validate migrations
  - Run each migration against a scratch schema; assert CHECK constraints reject out-of-enum values, the partial unique index blocks a second PENDING/ACTIVE subscription per category, and the RPC rolls back fully on an injected failure. Ensure all tests pass, ask the user if questions arise.

- [x] 3. Pure decision logic and Zod schemas
  - [x] 3.1 Implement mobile normalization
    - Create `src/lib/mobile/normalizeMobile.ts`: strip spaces/`+91`/leading `0`, validate `[6-9]\d{9}`, return `{ ok: true; value } | { ok: false }`, idempotent
    - _Requirements: 2.11, 3.2_

  - [x]* 3.2 Write property test for mobile normalization
    - **Property 1: Mobile normalization is canonical and idempotent**
    - **Validates: Requirements 2.11, 3.2**
    - Location: `src/lib/mobile/__tests__/normalizeMobile.property.test.ts`

  - [x] 3.3 Implement OTP policy state machine
    - Create `src/lib/otp/otpPolicy.ts`: pure `evaluateOtpPolicy(state, action, now)` covering 300s validity window, 5-attempt/900s lockout, 30s resend cooldown, max 3 resends/900s, and delivery-failure not consuming a resend
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x]* 3.4 Write property test for OTP validity window
    - **Property 3: OTP validity window**
    - **Validates: Requirements 2.3, 2.6**
    - Location: `src/lib/otp/__tests__/otpPolicy.property.test.ts`

  - [x]* 3.5 Write property test for OTP throttle policy
    - **Property 4: OTP throttle policy state machine**
    - **Validates: Requirements 2.5, 2.7, 2.8, 2.9, 2.10**
    - Location: `src/lib/otp/__tests__/otpPolicy.property.test.ts`

  - [x] 3.6 Implement cutoff date logic
    - Create `src/lib/onboarding/cutoff.ts`: `earliestStartDate(now, cutoff=17:00 IST)` and `isStartDateAllowed(startDate, now)` (today+1 before cutoff, today+2 at/after)
    - _Requirements: 7.5, 7.6, 7.7_

  - [x]* 3.7 Write property test for earliest start date
    - **Property 9: Earliest selectable start date from cutoff**
    - **Validates: Requirements 7.5, 7.6, 7.7**
    - Location: `src/lib/onboarding/__tests__/cutoff.property.test.ts`

  - [x] 3.8 Implement category, routing, sections, and test-email helpers
    - Create `src/lib/onboarding/category.ts` (`assertValidCategory`, `assertSinglePrimary`), `src/lib/onboarding/routing.ts` (`isRoutable(startDate, currentDate)`), `src/lib/onboarding/sections.ts` (status→section mapping), `src/lib/onboarding/testEmail.ts` (`placeholderEmailFor`, `isDisplayableEmail`)
    - _Requirements: 6.7, 6.8, 6.11, 10.4, 13.1, 13.2, 13.3, 13.4_

  - [x]* 3.9 Write property test for routing eligibility
    - **Property 7: Routing eligibility follows start date**
    - **Validates: Requirements 6.7, 6.8**
    - Location: `src/lib/onboarding/__tests__/routing.property.test.ts`

  - [x]* 3.10 Write property test for dashboard section partition
    - **Property 8: Dashboard section partition**
    - **Validates: Requirements 6.11**
    - Location: `src/lib/onboarding/__tests__/sections.property.test.ts`

  - [x] 3.11 Implement serviceable-pincode gate logic
    - Create `src/lib/address/serviceablePincode.ts`: `isServiceable(pincode, serviceAreaPincodes)` and a `canSaveAddress` helper requiring serviceable pincode plus non-empty flat number
    - _Requirements: 5.6, 5.8_

  - [x]* 3.12 Write property test for serviceable-pincode gate
    - **Property 17: Serviceable-pincode gate for captured address**
    - **Validates: Requirements 5.6, 5.8**
    - Location: `src/lib/address/__tests__/serviceablePincode.property.test.ts`

  - [x] 3.13 Implement Zod validation schemas
    - Create `src/validations/onboardingSchema.ts` (`quickOnboardingSchema` with `CUSTOMER_CATEGORIES`/`PAYMENT_STATUSES`), `src/validations/addressCaptureSchema.ts` (`createAddressCaptureSchema` with Home/Office tag, flat/floor, serviceability refine), `src/validations/realEmailSchema.ts`, `src/validations/profileCompletionSchema.ts` (all fields optional, independently validated)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 9.2, 9.3, 10.2, 10.5, 13.2_

  - [x]* 3.14 Write unit tests for validation schemas
    - Test enum rejection, length bounds, required-flat-number, all-optional profile schema, and email length/format edges
    - _Requirements: 4.1, 4.2, 4.3, 5.4, 9.2, 10.2_

- [x] 4. Checkpoint - ensure pure logic and schemas pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Data-access layer (repositories)
  - [x] 5.1 Implement customer onboarding repository
    - Create `src/repositories/customerOnboardingRepository.ts`: `findCustomerByMobile`, `onboardCustomerAtomic` (calls `onboard_customer` RPC), `generateUniqueCustomerCode` (retry on collision), `listByOnboardingStatus`, `setOnboardingCompleted`, `updateProfileFields`, `replaceTestEmailWithReal`
    - Map repository results to specific outcomes (duplicate mobile, email-in-use) rather than raw Postgres errors
    - _Requirements: 3.1, 6.6, 9.3, 9.4, 10.6, 10.7, 12.4, 14.7, 14.8_

  - [x] 5.2 Implement OTP throttle repository
    - Create `src/repositories/otpThrottleRepository.ts`: `getThrottle(mobile)`, `saveThrottle(mobile, state)` over `otp_login_throttle` using the service-role client
    - _Requirements: 2.5, 2.7, 2.9, 2.10_

- [x] 6. Business services
  - [x] 6.1 Implement EligibilityChecker
    - Create `src/services/EligibilityChecker.ts`: `check(mobile)` returning eligible only for exactly one CUSTOMER record in `IN_PROGRESS`/`COMPLETED`; zero→`NOT_REGISTERED`, bad status→`BAD_STATUS`, many→`AMBIGUOUS`, invalid→`INVALID_FORMAT`; never sends OTP or creates a session on non-eligible
    - _Requirements: 3.1, 3.4, 3.5, 9.6, 9.9, 12.1, 12.2, 12.3, 12.4_

  - [x]* 6.2 Write property test for eligibility decision
    - **Property 2: Eligibility decision is exactly-one-allowed-customer**
    - **Validates: Requirements 3.1, 3.4, 3.5, 9.6, 9.9, 12.1, 12.2, 12.3, 12.4**
    - Location: `src/services/__tests__/eligibilityChecker.property.test.ts`

  - [x] 6.3 Implement OtpLoginService
    - Create `src/services/OtpLoginService.ts`: `requestOtp`/`verifyOtp`/`resendOtp` wrapping Supabase phone OTP (`shouldCreateUser: false`) and applying `evaluateOtpPolicy` over the throttle repository; return typed statuses (SENT/COOLDOWN/LOCKED/RESEND_EXCEEDED/SEND_FAILED, OK/INVALID/EXPIRED/LOCKED)
    - _Requirements: 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.3, 3.6_

  - [x] 6.4 Implement BillingService
    - Create `src/services/BillingService.ts`: `recordOnboardingInvoice` inserting exactly one PAID `payments` row (`amount` = due, `paid_at` = now), rejecting when a PAID row already exists; read helpers for the customer Billing view
    - _Requirements: 8.3, 8.4, 8.6, 11.3, 11.4_

  - [x]* 6.5 Write property test for single PAID invoice
    - **Property 10: Single PAID invoice with correct amount**
    - **Validates: Requirements 8.3, 8.4, 8.6**
    - Location: `src/services/__tests__/billingService.property.test.ts`

  - [x] 6.6 Implement SubscriptionService (category + add-on)
    - Create `src/services/SubscriptionService.ts`: associate each subscription with exactly one `customer_category`; `activateAddOnCategory` gated on successful payment, isolating existing subscriptions on failure, rejecting a category the customer already actively holds
    - _Requirements: 13.7, 13.8, 13.9, 13.10, 13.11_

  - [x]* 6.7 Write property test for at-most-one-active-per-category
    - **Property 12: At most one active subscription per category**
    - **Validates: Requirements 13.10, 13.11**
    - Location: `src/services/__tests__/subscriptionService.property.test.ts`

  - [x]* 6.8 Write property test for payment-gated add-on activation
    - **Property 13: Add-on activation is payment-gated and isolated**
    - **Validates: Requirements 13.7, 13.8, 13.9**
    - Location: `src/services/__tests__/subscriptionService.property.test.ts`

  - [x] 6.9 Implement OnboardingService
    - Create `src/services/OnboardingService.ts`: `onboard` (scope resolution via `resolveClinicForPincode`, reject if unresolved; create auth identity with placeholder/real email; delegate atomic write to repository RPC; compensate by deleting auth identity on failure; enforce PAID precondition and single-invoice), `completeProfile` (persist + optional transition to COMPLETED), and wire `activateAddOnCategory`
    - _Requirements: 4.6, 4.7, 5.5, 6.1, 6.2, 6.3, 6.5, 6.6, 8.1, 8.2, 9.3, 9.4, 9.8, 10.1, 10.6, 10.7, 10.8, 13.1, 13.2, 13.3, 13.4, 14.2, 14.5, 14.6, 14.7, 14.8_

  - [x]* 6.10 Write property test for onboarding precondition gate and record shape
    - **Property 5: Onboarding precondition gate and created-record shape**
    - **Validates: Requirements 4.1, 4.2, 4.5, 4.6, 4.7, 5.5, 6.1, 6.2, 6.3, 6.5, 8.1, 8.2, 14.2**
    - Location: `src/services/__tests__/onboardingService.property.test.ts`

  - [x]* 6.11 Write property test for onboarding atomicity
    - **Property 6: Onboarding atomicity (no partial record)**
    - **Validates: Requirements 6.6, 9.8, 14.6**
    - Location: `src/services/__tests__/onboardingService.property.test.ts`

  - [x]* 6.12 Write property test for exactly one valid Primary_Category
    - **Property 11: Exactly one valid Primary_Category**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
    - Location: `src/services/__tests__/onboardingService.property.test.ts`

  - [x]* 6.13 Write property test for test-email placeholder behavior
    - **Property 16: Test-email placeholder is unique, hidden, and replaceable**
    - **Validates: Requirements 10.1, 10.3, 10.4, 10.6, 10.7, 10.8, 14.4**
    - Location: `src/services/__tests__/onboardingService.property.test.ts`

  - [x]* 6.14 Write property test for unique customer code generation
    - **Property 18: Unique customer code generation**
    - **Validates: Requirements 14.7, 14.8**
    - Location: `src/services/__tests__/onboardingService.property.test.ts`

  - [x] 6.15 Implement profile-completion persistence in OnboardingService
    - Extend `completeProfile` to persist only provided valid fields, reject on any format failure (retain values, identify invalid fields), all-or-nothing on persistence failure, and transition to COMPLETED on "mark completed"; gate dialog visibility on `IN_PROGRESS`
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.7, 9.8, 14.1, 14.3_

  - [x]* 6.16 Write property test for profile-completion validation and persistence
    - **Property 14: Profile-completion optional-field validation and persistence**
    - **Validates: Requirements 9.2, 9.3, 9.7**
    - Location: `src/services/__tests__/profileCompletion.property.test.ts`

  - [x]* 6.17 Write property test for status-driven completion and dialog visibility
    - **Property 15: Onboarding status drives completion and dialog visibility**
    - **Validates: Requirements 9.4, 9.5, 14.1, 14.3**
    - Location: `src/services/__tests__/profileCompletion.property.test.ts`

- [ ] 7. Checkpoint - ensure services and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Server actions (orchestration layer)
  - [x] 8.1 Implement admin onboarding actions
    - Create `src/actions/admin-actions/onboardingActions.ts`: `onboardCustomerAction` (Zod re-validate, assert PAID, assert start date ≥ earliest via cutoff), `listOnboardedCustomersAction`, `listCompletedCustomersAction`, `activateAddOnCategoryAction`; admin-only; return `{ error, fieldErrors }` on validation issues
    - _Requirements: 4.6, 4.7, 6.1, 6.4, 6.5, 6.9, 6.10, 7.7, 8.1, 8.2, 13.7, 14.6_

  - [x] 8.2 Implement customer mobile auth actions
    - Create `src/actions/mobileAuthActions.ts`: `requestOtpAction`, `verifyOtpAction`, `resendOtpAction` (normalize mobile → eligibility check → OtpLoginService → Supabase phone OTP); establish session and redirect to dashboard on verify
    - _Requirements: 2.2, 2.4, 2.5, 2.6, 2.9, 2.10, 3.1, 3.4, 12.1, 12.2, 12.3, 12.4_

  - [x] 8.3 Implement customer profile-completion actions
    - Create `src/actions/profileCompletionActions.ts`: `saveProfileCompletionAction`, `markOnboardingCompletedAction`, `submitRealEmailAction` (customer-portal, delegating to OnboardingService)
    - _Requirements: 9.3, 9.4, 9.7, 9.8, 10.6, 10.7, 10.8_

  - [x] 8.4 Neutralize legacy signup/OAuth routes
    - Redirect customer signup route and OAuth/signup callback endpoints to the mobile login screen without creating accounts; retain the legacy 3-step admin customer-creation flow untouched
    - _Requirements: 1.4, 1.5, 4.8_

- [x] 9. Admin UI (desktop-first, Design_System)
  - [x] 9.1 Build map-based Address_Capture component
    - Create `src/shared/components/address/AddressCaptureMap.tsx` (client): Google Map + Places Autocomplete search, draggable pin, reverse-geocode auto-fill of area/city/state/pincode + lat/lng, Home/Office tag (default Home), flat/floor inputs, not-serviceable warning, unresolved-locality error; reuse layout from `src/shared/components/customer/address-picker-map.tsx`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 15.13_

  - [x] 9.2 Build Quick_Onboarding_Form wizard
    - Create `src/app/admin/(main)/customers/quick-onboard/page.tsx` (RSC shell) + `QuickOnboardingForm.tsx` (client wizard): Details → Category/Plan → Address → Payment/Review; React Hook Form + Zod; test-email field + checkbox; mark-payment-collected control; cutoff warning with acknowledgment checkbox gating a disabled "Onboard Customer" button; earliest-date enforcement; inline errors, loading/disabled states, success toast
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.5, 10.2, 13.2, 15.2, 15.3, 15.6, 15.7, 15.8, 15.9, 15.11_

  - [x] 9.3 Build Onboarded / Completed dashboard sections
    - Update `src/app/admin/(main)/customers/page.tsx` (RSC) with tabs listing `IN_PROGRESS` and `COMPLETED` customers via the list actions, with empty states consistent with existing styling
    - _Requirements: 6.9, 6.10, 6.11, 15.10_

- [x] 10. Customer UI (mobile-first, Design_System)
  - [x] 10.1 Rewrite mobile OTP login screen
    - Rewrite `src/app/customer/(auth)/login/page.tsx` (RSC shell) + `MobileOtpLoginForm.tsx` (client): single mobile field → OTP entry; remove signup link, Google button, and email/password; wire to mobile auth actions with resend cooldown, lockout, expired/invalid messaging; mobile-first 360px single-column layout
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.5, 2.6, 2.7, 2.9, 2.10, 15.1, 15.4, 15.5, 15.7, 15.9_

  - [x] 10.2 Build profile completion dialog
    - Create `src/shared/components/customer/ProfileCompletionDialog.tsx` (client, Radix Dialog): shown on dashboard when `IN_PROGRESS`; renders an input per empty field, all optional; real-email input when flagged as test email; "mark completed onboarding" action; focus trap/restore, accessible labels
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 10.5, 15.1, 15.12_

  - [x] 10.3 Wire account and billing views for onboarded customers
    - Update customer account view (`src/app/customer/(main)/subscription/page.tsx`) to show the onboarding subscription (plan name, start date, status) with a no-subscription error state, and the Billing view to show the onboarding invoice (amount, issue date, status) with a no-invoice error state; ensure onboarded customers get the same navigation/permissions as legacy customers
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 11. Integration and access enforcement
  - [x] 11.1 Enforce mobile access rules in middleware
    - Update `src/middleware.ts` customer-portal checks: grant only when role is CUSTOMER with exactly one record in `IN_PROGRESS`/`COMPLETED`; deny otherwise (not registered, bad status, ambiguous) and redirect to `/unauthorized` or login
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 11.2 Write integration tests for external-service wiring
    - Supabase phone OTP send/verify and session establishment (2.2/2.4/3.3), OAuth/signup callback rejection (1.5), Google reverse-geocode auto-fill (5.3), and access parity for onboarded customers (11.5)
    - _Requirements: 1.5, 2.2, 2.4, 3.3, 5.3, 11.5_

  - [ ]* 11.3 Write component/snapshot tests for UI behavior
    - Login omits signup/Google/email-password (1.1–1.3), signup route redirects (1.4), Home/Office default (5.1), test-email checkbox present (10.2), account/billing display + empty states (11), cutoff-warning enable/disable toggle (7.1–7.4), and portal styling/360px layout/loading/disabled/empty/success states (15.1–15.11)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 7.1, 7.2, 7.3, 7.4, 10.2, 11.1, 11.3, 15.1, 15.5, 15.7, 15.8, 15.10, 15.11_

  - [ ]* 11.4 Run automated accessibility checks on new screens
    - Run axe against the login, OTP entry, profile dialog, quick-onboarding form, and address capture for the mechanical subset (labels, focus trap, contrast tokens); note that full WCAG 2.1 AA conformance requires manual assistive-technology review
    - _Requirements: 15.12_

- [ ] 12. Final checkpoint - ensure all tests pass
  - Run `npm run lint` and `npm run test`; fix any failures. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement sub-clauses for traceability, and each property test references its design property number.
- Migrations are additive and idempotent with rollback headers, per steering; `email` stays NOT NULL + UNIQUE and mobile-first identity is satisfied with a deterministic placeholder email.
- Property tests use vitest + fast-check with a minimum of 100 iterations and mocked repositories, testing logic rather than I/O.
- Consult `node_modules/next/dist/docs/` before writing route/server-action code (Next.js 16 breaking changes).
- No cross-portal imports: shared UI lives in `src/shared/components`, shared logic in `src/lib`/`src/services`/`src/repositories`/`src/validations`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5"] },
    { "id": 2, "tasks": ["3.1", "3.3", "3.6", "3.8", "3.11", "3.13"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.5", "3.7", "3.9", "3.10", "3.12", "3.14", "5.1", "5.2"] },
    { "id": 4, "tasks": ["6.1", "6.3", "6.4", "6.6", "6.9"] },
    { "id": 5, "tasks": ["6.2", "6.5", "6.7", "6.8", "6.10", "6.11", "6.12", "6.13", "6.14", "6.15"] },
    { "id": 6, "tasks": ["6.16", "6.17", "8.1", "8.2", "8.3", "8.4"] },
    { "id": 7, "tasks": ["9.1", "9.3", "10.1", "10.3", "11.1"] },
    { "id": 8, "tasks": ["9.2", "10.2"] },
    { "id": 9, "tasks": ["11.2", "11.3", "11.4"] }
  ]
}
```
