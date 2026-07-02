# Implementation Plan: Customer PIN Authentication

## Overview

Replace SMS OTP login with PIN-based authentication for the Customer Portal. Implementation proceeds bottom-up: database schema → utility/service layer → server actions → UI components → admin integration → cleanup of OTP references.

## Tasks

- [x] 1. Database schema and PIN utilities
  - [x] 1.1 Create migration script for PIN columns on users table
    - Create `scripts/add-pin-auth-columns-to-users.sql`
    - Add `pin_hash TEXT` (nullable), `is_temp_pin BOOLEAN NOT NULL DEFAULT true`, `pin_set_at TIMESTAMPTZ` (nullable) using `ADD COLUMN IF NOT EXISTS`
    - Include header comment, rollback instructions, idempotency guards per project conventions
    - Do NOT modify `otp_login_throttle` table or any existing columns
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 1.2 Implement PIN utility functions (`src/lib/pin/pinUtils.ts`)
    - `isValidPinFormat(pin: string): boolean` — returns true only for strings matching `/^\d{6}$/`
    - `generateTemporaryPin(): string` — cryptographically random 6-digit numeric string
    - Re-export `normalizeMobile` from existing mobile utilities
    - _Requirements: 3.5, 4.2, 6.2, 6.3, 7.3, 9.1_

  - [x]* 1.3 Write property tests for PIN utilities
    - **Property 11: PIN format validation rejects non-6-digit-numeric strings**
    - **Property 12: Auto-generate always produces valid PIN format**
    - **Validates: Requirements 3.5, 4.2, 6.2, 6.3, 7.3**
    - Use `fast-check` with Vitest, minimum 100 iterations

- [x] 2. PinService implementation
  - [x] 2.1 Implement PinService (`src/services/PinService.ts`)
    - `hashPin(pin)` — bcrypt hash with cost factor 10, never store/log plaintext
    - `verifyPin(mobile, pin)` — lookup `pin_hash` + `is_temp_pin` from users table via service-role client, bcrypt.compare (constant-time)
    - `setPermanentPin(mobile, newPin)` — hash new PIN, UPDATE `pin_hash`, set `is_temp_pin = false`, set `pin_set_at = now()`
    - `resetPinToTemporary(userId, newPin)` — hash new PIN, UPDATE `pin_hash`, set `is_temp_pin = true`, set `pin_set_at = now()`
    - All DB access via service-role Supabase client (no RLS exposure)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 2.2, 2.6, 7.4_

  - [x]* 2.2 Write property tests for PinService hash/verify
    - **Property 1: PIN hash round-trip with minimum cost**
    - **Property 2: Distinct PINs never collide on comparison**
    - **Validates: Requirements 1.4, 2.2, 9.1, 9.5**
    - Use `fast-check` + Vitest, minimum 100 iterations

  - [x]* 2.3 Write property test for setPermanentPin
    - **Property 4: Set permanent PIN clears temp flag**
    - **Validates: Requirements 2.6**
    - Mock DB layer, verify hash round-trip + flag state

- [x] 3. PinThrottleService implementation
  - [x] 3.1 Implement PinThrottleService (`src/services/PinThrottleService.ts`)
    - `checkThrottle(mobile)` — SELECT from `otp_login_throttle`, return LOCKED if `locked_until` is future, reset if expired
    - `incrementFailure(mobile)` — UPSERT `failed_attempts + 1`, set `locked_until = now() + 15min` when reaching 5
    - `resetThrottle(mobile)` — reset `failed_attempts` to 0 on successful verification
    - Use only `failed_attempts`, `locked_until`, `window_started_at`, `updated_at` columns (ignore `resend_count`, `last_sent_at`)
    - Access via service-role client only
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 14.5_

  - [x]* 3.2 Write property tests for PinThrottleService
    - **Property 6: Incorrect PIN increments failed_attempts**
    - **Property 7: Lockout engages at threshold**
    - **Property 8: Locked state rejects all PIN attempts**
    - **Property 9: Lock expiry resets throttle and allows attempts**
    - **Property 10: Correct PIN resets failed_attempts**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
    - Use `fast-check` + Vitest, minimum 100 iterations, mock DB layer for state machine tests

- [x] 4. Checkpoint - Core services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Server Actions for PIN authentication
  - [x] 5.1 Implement `checkEligibilityAction` in `src/actions/pinAuthActions.ts`
    - Normalize mobile using `normalizeMobile`, validate format
    - Query `customer_profiles` + `users` for matching mobile with `onboarding_status` IN_PROGRESS or COMPLETED
    - Return `ELIGIBLE` or `NOT_ELIGIBLE` with appropriate message
    - Reuse existing eligibility checker logic pattern
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 5.2 Implement `verifyPinAction` in `src/actions/pinAuthActions.ts`
    - Call `PinThrottleService.checkThrottle(mobile)` — return LOCKED if locked
    - Call `PinService.verifyPin(mobile, pin)` — if invalid, call `incrementFailure`, return INVALID or LOCKED
    - If valid + `isTempPin = false`: call `signInWithPassword(email, serverPassword)`, reset throttle, return OK
    - If valid + `isTempPin = true`: reset throttle, return TEMP_PIN
    - Handle `signInWithPassword` failure: log error (no plaintext PIN), return generic error
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 5.1, 5.2, 5.3, 5.5, 11.1, 11.4_

  - [x] 5.3 Implement `setPermanentPinAction` in `src/actions/pinAuthActions.ts`
    - Validate both PINs are 6-digit numeric format
    - Check `newPin === confirmPin`, return MISMATCH if not
    - Call `PinService.setPermanentPin(mobile, newPin)`
    - Call `signInWithPassword(email, serverPassword)` to establish session
    - Return OK on success
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 9.4_

  - [x]* 5.4 Write property test for PIN mismatch rejection
    - **Property 3: PIN mismatch rejection preserves state**
    - **Validates: Requirements 2.5**
    - Use `fast-check` + Vitest, generate distinct PIN pairs

  - [x]* 5.5 Write property test for temp PIN store round-trip
    - **Property 13: Store temporary PIN produces verifiable hash with temp flag**
    - **Validates: Requirements 6.4, 6.6, 7.4**

- [x] 6. Customer Portal UI components
  - [x] 6.1 Implement `PinInput` component (`src/shared/components/customer/PinInput.tsx`)
    - Six individual digit boxes or single masked 6-digit numeric field
    - Input type restricted to numeric only
    - Client-side validation: reject non-6-digit-numeric submissions
    - Accessible with proper ARIA labels
    - _Requirements: 13.3, 3.5_

  - [x] 6.2 Implement `MobilePinLoginForm` component (`src/shared/components/customer/MobilePinLoginForm.tsx`)
    - Two-step form: Step 1 — mobile number input, Step 2 — PIN entry (revealed after eligibility)
    - Step 1: single mobile field, submit calls `checkEligibilityAction`
    - Step 2: PinInput + "Forgot PIN?" link + "Back" button
    - On PIN submit: call `verifyPinAction`, handle OK/TEMP_PIN/INVALID/LOCKED outcomes
    - No reference to OTP, SMS, or "Enter code" anywhere in the UI
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 1.5, 3.4, 8.1_

  - [x] 6.3 Implement `SetNewPinForm` component (`src/shared/components/customer/SetNewPinForm.tsx`)
    - Two PinInput fields: new PIN + confirm PIN
    - "Set PIN" submit button
    - Clear instruction text explaining customer must choose a new PIN
    - On submit: call `setPermanentPinAction`, handle MISMATCH/OK/ERROR
    - Display error message when PINs don't match
    - _Requirements: 2.4, 2.5, 2.7, 13.6, 13.7_

  - [x] 6.4 Implement Forgot PIN display (`src/shared/components/customer/ForgotPinInfo.tsx`)
    - Display message instructing customer to contact admin (phone or clinic visit)
    - No self-service reset mechanism (no email, no SMS, no security questions)
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 6.5 Wire login page to use `MobilePinLoginForm` and `SetNewPinForm`
    - Update customer login page to render `MobilePinLoginForm` instead of OTP form
    - Add routing logic: if `verifyPinAction` returns TEMP_PIN, navigate to set-new-pin screen
    - After successful set-new-pin, redirect to dashboard
    - If customer navigates away from set-new-pin with temp flag still true, end partial session and return to login
    - _Requirements: 2.3, 2.7, 2.8, 2.9, 3.2_

- [x] 7. Checkpoint - Customer login flow
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Admin portal integration
  - [x] 8.1 Implement `TempPinField` component (`src/shared/components/admin/TempPinField.tsx`)
    - 6-digit numeric PIN input field with "Auto-generate" button
    - Auto-generate uses `generateTemporaryPin()` and populates the field
    - Validation: reject non-6-digit-numeric values on form submit
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 8.2 Integrate TempPinField into Quick Onboarding Form
    - Add `TempPinField` to existing Quick Onboarding Form (additive, do not change existing validations)
    - On form submit: call `PinService.hashPin(tempPin)` to get `pin_hash`
    - Pass `pin_hash` and `is_temp_pin: true` in the `user` object to `onboard_customer` RPC
    - Ensure existing form validations (name, mobile, gender, diet, plan, start date, payment, address) remain unchanged
    - _Requirements: 6.4, 6.5, 6.6, 14.1, 14.2_

  - [x] 8.3 Implement `ResetPinDialog` component (`src/shared/components/admin/ResetPinDialog.tsx`)
    - Dialog with 6-digit PIN input + auto-generate option
    - Validation: reject non-6-digit-numeric values
    - On submit: call `resetCustomerPinAction(userId, newPin)`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 8.4 Implement `resetCustomerPinAction` in `src/actions/admin-actions/adminPinActions.ts`
    - Accept `userId` and `newPin`, validate PIN format
    - Call `PinService.resetPinToTemporary(userId, newPin)`
    - Never store/log plaintext PIN after hashing
    - Return `{ success: boolean; error?: string }`
    - _Requirements: 7.4, 7.5, 7.6_

  - [x] 8.5 Add "Reset PIN" button to Customer 360 view
    - Add "Reset PIN" action trigger in the existing Customer 360 admin view
    - Opens `ResetPinDialog` with the customer's userId
    - After successful reset, customer forced to set permanent PIN on next login
    - _Requirements: 7.1, 7.5_

- [x] 9. Session and middleware integration
  - [x] 9.1 Implement session establishment logic in server actions
    - After successful PIN verification (permanent) or set-new-pin completion, call `signInWithPassword` with customer's placeholder email + server-managed password
    - Server-managed password is set during onboarding via admin API (`admin.createUser`)
    - Ensure session is compatible with existing middleware role-checks (no middleware changes needed)
    - Handle `signInWithPassword` failure: log error, return generic error, do not grant access
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 9.2 Implement temp PIN route protection
    - When `is_temp_pin` is true for a customer's account, block access to all protected routes (dashboard, profile, subscription, billing)
    - Redirect to set-new-pin screen if temp flag is true
    - If customer navigates away from set-new-pin without completing, end partial session
    - _Requirements: 2.8, 2.9_

  - [x]* 9.3 Write property test for temp PIN route blocking
    - **Property 5: Temp PIN flag blocks all protected routes**
    - **Validates: Requirements 2.8**
    - Mock session with `is_temp_pin = true`, verify all protected routes return redirect

- [x] 10. Remove OTP references from customer login flow
  - [x] 10.1 Remove SMS OTP code from customer login path
    - Remove or replace `signInWithOtp` and `verifyOtp` calls in customer-facing code
    - Remove OTP-related UI components from the customer login flow (OTP input, resend button, etc.)
    - Ensure no import of `supabase.auth.signInWithOtp({ phone: ... })` remains in customer login paths
    - Ensure no import of `supabase.auth.verifyOtp({ phone: ..., token: ..., type: 'sms' })` remains in customer login paths
    - Update `mobileAuthActions.ts` to implement PIN actions or replace it with `pinAuthActions.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 12.1, 12.2, 12.3, 12.4_

- [x] 11. Final checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `otp_login_throttle` table is reused as-is; only `failed_attempts`, `locked_until`, `window_started_at`, `updated_at` columns are used
- All PIN operations use the service-role Supabase client (no RLS exposure)
- The existing middleware and session logic remain unchanged; PIN login produces the same session shape as OTP login did

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["5.4", "5.5", "6.2", "6.3", "6.4", "8.1"] },
    { "id": 6, "tasks": ["6.5", "8.2", "8.3", "8.4"] },
    { "id": 7, "tasks": ["8.5", "9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3"] },
    { "id": 9, "tasks": ["10.1"] }
  ]
}
```
