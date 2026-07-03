# Requirements Document

## Introduction

This feature **replaces the SMS OTP login flow** (built in the `customer-mobile-onboarding` spec) with a **PIN-based login model** for customers on the ArogyaDiet Customer Portal (`customer.arogyadiet.com`).

**Business reason:** The client wants to eliminate the recurring per-SMS OTP costs and the one-time SMS-gateway activation charges. Because every customer is onboarded in person at the clinic, the admin can hand over a temporary PIN at the counter — no messaging round-trip needed.

**How it works:** During admin-initiated quick onboarding, the admin sets (or auto-generates) a 6-digit temporary PIN for the customer. The customer logs in with mobile + temporary PIN, is forced to set a permanent PIN on first login, and thereafter logs in with mobile + permanent PIN. The existing `otp_login_throttle` table (keyed on `mobile TEXT PRIMARY KEY`) is reused as-is for brute-force protection on PIN attempts.

**What stays the same:** Mobile number as identity, the pre-PIN eligibility check (mobile must map to exactly one CUSTOMER with `onboarding_status` IN_PROGRESS or COMPLETED), the `otp_login_throttle` table structure, all other onboarding flows (admin quick-onboard, profile completion, cutoff, payment, categories), and middleware access gating.

**What changes:** Supabase phone OTP (`signInWithOtp`, `verifyOtp`) is removed from the login flow. Authentication session is established via `signInWithPassword` using the placeholder email + a server-managed password (or a custom token approach). The login UI changes from "enter OTP code" to "enter PIN" (with a "set new PIN" screen for first-time/temp-PIN users). The admin onboarding form adds a "Temporary PIN" field. A "Forgot PIN" flow requires admin intervention (admin sets a new temp PIN).

**Database grounding (live schema inspected):**

- `users` — columns: `id` (uuid PK), `auth_user_id` (uuid UNIQUE), `email` (varchar NOT NULL UNIQUE), `mobile` (varchar UNIQUE), `is_test_email` (boolean NOT NULL DEFAULT false), `franchise_id`, `is_active`, `force_password_change`, plus audit fields. No `pin_hash` or `is_temp_pin` column exists yet.
- `customer_profiles` — columns: `id` (uuid PK), `user_id` (uuid UNIQUE FK), `customer_code` (varchar UNIQUE), `onboarding_status` (text NOT NULL DEFAULT 'IN_PROGRESS', CHECK IN_PROGRESS|COMPLETED), `franchise_id`, `clinic_id`, plus profile fields.
- `otp_login_throttle` — columns: `mobile` (text PK, CHECK `^[6-9][0-9]{9}$`), `window_started_at` (timestamptz NOT NULL DEFAULT now()), `failed_attempts` (integer NOT NULL DEFAULT 0), `resend_count` (integer NOT NULL DEFAULT 0), `last_sent_at` (timestamptz), `locked_until` (timestamptz), `updated_at` (timestamptz NOT NULL DEFAULT now()). RLS enabled, no policies (service-role only access).

## Glossary

- **Customer_Portal**: The customer-facing web application served at `customer.arogyadiet.com` (the `src/app/customer` portal).
- **Admin_Dashboard**: The admin-facing operations application (the `src/app/admin` portal).
- **Auth_Service**: The authentication component responsible for issuing and validating sessions, built on Supabase Auth.
- **PIN_Service**: The component that validates a submitted mobile-number + PIN pair against the stored hashed PIN, manages the PIN lifecycle (setting, changing, temporary-to-permanent transition, and admin reset).
- **PIN**: A 6-digit numeric secret used together with a mobile number to authenticate a customer, stored only as a bcrypt hash and never in plaintext.
- **Temporary_PIN**: An admin-set, one-time PIN that authenticates the customer once and forces the customer to set a new permanent PIN on the next successful login.
- **Permanent_PIN**: A customer-chosen 6-digit PIN that replaces the Temporary_PIN after the forced reset and is used for all subsequent logins.
- **Login_Throttle**: The failed-attempt lockout mechanism backed by the existing `otp_login_throttle` table that temporarily blocks login for a mobile number after too many failed PIN attempts.
- **Eligibility_Checker**: The server-side component that determines whether a given mobile number is associated with an existing Customer_Record with `onboarding_status` IN_PROGRESS or COMPLETED before the PIN entry screen is revealed.
- **Quick_Onboarding_Form**: The admin form used to rapidly create a customer with priority information plus a subscription plan and payment status — already implemented, now extended with a Temporary_PIN field.
- **Customer_Record**: A row in `customer_profiles` linked to a `users` row, identified by the customer's mobile number.
- **Onboarding_Status**: The lifecycle state of a Customer_Record: `IN_PROGRESS` or `COMPLETED`.
- **PIN_Hash**: The bcrypt-hashed representation of a customer's PIN, stored in the `users` table as a TEXT column.
- **Temp_PIN_Flag**: A boolean column (`is_temp_pin`) on the `users` table indicating whether the current PIN_Hash represents an admin-set Temporary_PIN that must be changed on next login.
- **Customer_360**: The admin view showing full customer details, from which admins can reset a customer's PIN.
- **Throttle_Record**: A row in `otp_login_throttle` keyed by normalized mobile, tracking `failed_attempts`, `locked_until`, `window_started_at`, and `updated_at`.

## Requirements

### Requirement 1: Removal of SMS OTP Authentication

**User Story:** As the business owner, I want to eliminate SMS OTP from the customer login flow, so that the platform incurs no per-SMS charges or gateway activation fees.

#### Acceptance Criteria

1. THE Customer_Portal SHALL NOT invoke `signInWithOtp` or any SMS-sending authentication method during the customer login flow.
2. THE Customer_Portal SHALL NOT invoke `verifyOtp` or any SMS-code-verification method during the customer login flow.
3. THE Auth_Service SHALL NOT depend on a Supabase phone OTP provider for customer authentication.
4. WHEN a customer submits credentials on the login screen, THE PIN_Service SHALL authenticate the customer using mobile number + PIN verification against the stored PIN_Hash, without sending or receiving any SMS message.
5. THE Customer_Portal SHALL NOT display an "Enter OTP" input or any reference to a one-time code sent via SMS on the login screen.

### Requirement 2: Mobile + PIN Login (First-Time Flow with Temporary PIN)

**User Story:** As a customer logging in for the first time after admin onboarding, I want to verify my identity with the temporary PIN the admin gave me and then set my own permanent PIN, so that I can securely access the app going forward.

#### Acceptance Criteria

1. WHEN the Eligibility_Checker confirms the submitted mobile number is associated with exactly one Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED, THE Customer_Portal SHALL reveal a PIN entry screen that accepts exactly 6 numeric digits.
2. WHEN a customer submits a valid 6-digit PIN on the PIN entry screen, THE PIN_Service SHALL compare the submitted PIN against the stored PIN_Hash for that mobile number using bcrypt comparison.
3. WHEN the submitted PIN matches the stored PIN_Hash and the Temp_PIN_Flag is true, THE Customer_Portal SHALL redirect the customer to a "Set New PIN" screen instead of the dashboard.
4. THE "Set New PIN" screen SHALL require the customer to enter a new 6-digit numeric PIN and confirm it by entering the same PIN a second time.
5. IF the new PIN and the confirmation PIN do not match on the "Set New PIN" screen, THEN THE Customer_Portal SHALL display an error message indicating the PINs do not match and SHALL NOT update the stored PIN_Hash.
6. WHEN the customer submits matching new PIN and confirmation PIN on the "Set New PIN" screen, THE PIN_Service SHALL replace the stored PIN_Hash with the bcrypt hash of the new PIN, set the Temp_PIN_Flag to false, and record the PIN change timestamp.
7. WHEN the PIN_Service successfully updates the PIN_Hash and clears the Temp_PIN_Flag, THE Auth_Service SHALL establish an authenticated session and redirect the customer to the dashboard.
8. WHILE the Temp_PIN_Flag is true for a customer's account, THE Customer_Portal SHALL NOT grant access to the dashboard, profile, subscription, billing, or any protected route until the customer completes the "Set New PIN" flow.
9. IF the customer navigates away from the "Set New PIN" screen without completing it (while the Temp_PIN_Flag remains true), THEN THE Customer_Portal SHALL end any partial session and return the customer to the login screen on next access.

### Requirement 3: Mobile + PIN Login (Subsequent Logins with Permanent PIN)

**User Story:** As a returning customer, I want to log in with my mobile number and permanent PIN, so that I can access my dashboard without any additional verification steps.

#### Acceptance Criteria

1. WHEN the Eligibility_Checker confirms the submitted mobile number is eligible, THE Customer_Portal SHALL reveal a PIN entry screen that accepts exactly 6 numeric digits.
2. WHEN a customer submits a valid 6-digit PIN and the PIN matches the stored PIN_Hash and the Temp_PIN_Flag is false, THE Auth_Service SHALL establish an authenticated session and redirect the customer to the dashboard.
3. IF a customer submits a PIN that does not match the stored PIN_Hash, THEN THE PIN_Service SHALL reject the submission, display a generic "Invalid PIN" message, and increment the failed-attempt counter in the Throttle_Record for that mobile number.
4. THE Customer_Portal SHALL display a "Forgot PIN?" link on the PIN entry screen that informs the customer to contact the admin for a PIN reset.
5. IF a customer submits a PIN that is not exactly 6 numeric digits, THEN THE Customer_Portal SHALL reject the submission client-side with a validation message and SHALL NOT send the submission to the server.

### Requirement 4: Pre-PIN Mobile Eligibility Check

**User Story:** As the business owner, I want the system to verify a mobile number belongs to a real or in-progress customer before revealing the PIN entry screen, so that non-customers cannot attempt PIN guesses.

#### Acceptance Criteria

1. WHEN a customer submits a mobile number on the login screen, THE Eligibility_Checker SHALL determine within 3 seconds whether the mobile number is associated with a Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED.
2. IF the submitted value is not a syntactically valid 10-digit mobile number (matching the pattern `[6-9][0-9]{9}`), THEN THE Eligibility_Checker SHALL reject the request and display a format-error message without revealing the PIN entry screen.
3. IF the submitted mobile number is associated with exactly one Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED, THEN THE Customer_Portal SHALL reveal the PIN entry screen for that mobile number.
4. IF the submitted mobile number is not associated with any Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED, THEN THE Eligibility_Checker SHALL reject the request and display the message "please contact admin" without revealing the PIN entry screen.
5. THE Eligibility_Checker SHALL perform the lookup against Customer_Records only, excluding users whose role is not CUSTOMER.
6. THE Customer_Portal SHALL normalize the submitted mobile number (strip spaces, country code prefix `+91`, leading `0`) to a canonical 10-digit form before the eligibility check, consistent with the `otp_login_throttle.mobile` CHECK constraint `^[6-9][0-9]{9}$`.

### Requirement 5: PIN Brute-Force Throttling (Reuse of otp_login_throttle)

**User Story:** As the business owner, I want failed PIN attempts to trigger a lockout after 5 failures, so that attackers cannot brute-force a customer's PIN.

#### Acceptance Criteria

1. WHEN a customer submits an incorrect PIN, THE Login_Throttle SHALL increment the `failed_attempts` counter in the existing `otp_login_throttle` row for that mobile number.
2. IF the `failed_attempts` counter reaches 5 within the current throttle window (since `window_started_at`), THEN THE Login_Throttle SHALL set `locked_until` to 15 minutes (900 seconds) from the current time and SHALL reject all subsequent PIN verification attempts for that mobile until `locked_until` has passed.
3. WHILE the current time is before `locked_until` for a given mobile number, THE Login_Throttle SHALL reject PIN verification attempts for that mobile and display a lockout message indicating when the customer may retry.
4. WHEN `locked_until` has passed for a mobile number, THE Login_Throttle SHALL reset `failed_attempts` to 0, update `window_started_at` to the current time, and allow PIN verification attempts to proceed.
5. WHEN a customer submits a correct PIN (successful verification), THE Login_Throttle SHALL reset `failed_attempts` to 0 for that mobile number.
6. THE Login_Throttle SHALL reuse the existing `otp_login_throttle` table structure without schema modifications, using the `mobile`, `failed_attempts`, `locked_until`, `window_started_at`, and `updated_at` columns for PIN throttling.
7. THE Login_Throttle SHALL access the `otp_login_throttle` table exclusively through the service-role client, consistent with the table's RLS configuration (enabled, no policies).

### Requirement 6: Admin Temporary PIN Creation During Onboarding

**User Story:** As an admin onboarding a customer, I want to set or auto-generate a 6-digit temporary PIN for the customer, so that the customer can log in with that PIN and then set their own permanent PIN.

#### Acceptance Criteria

1. THE Quick_Onboarding_Form SHALL include a "Temporary PIN" field that accepts exactly 6 numeric digits.
2. THE Quick_Onboarding_Form SHALL provide an "Auto-generate" button adjacent to the Temporary PIN field that generates a random 6-digit numeric value and populates the field.
3. IF the admin submits the Quick_Onboarding_Form with a Temporary PIN that is not exactly 6 numeric digits, THEN THE form SHALL reject the submission and display a validation error for the Temporary PIN field.
4. WHEN a customer is created via the Quick_Onboarding_Form with a valid Temporary PIN, THE PIN_Service SHALL store the PIN only as a bcrypt hash in the `pin_hash` column of the `users` table and set `is_temp_pin` to true.
5. THE PIN_Service SHALL never store or log the Temporary PIN in plaintext after hashing.
6. WHEN the `onboard_customer` RPC completes successfully, THE `users` row for the new customer SHALL have `pin_hash` set to the bcrypt hash of the admin-provided Temporary PIN and `is_temp_pin` set to true.

### Requirement 7: Admin PIN Reset from Customer 360

**User Story:** As an admin, I want to reset a customer's PIN from the Customer 360 dashboard by setting a new temporary PIN, so that a customer who forgot their PIN can log in again and set a new permanent PIN.

#### Acceptance Criteria

1. THE Customer_360 view in the Admin_Dashboard SHALL provide a "Reset PIN" action for each customer.
2. WHEN an admin activates the "Reset PIN" action, THE Admin_Dashboard SHALL display a dialog that accepts a new 6-digit numeric PIN or offers an auto-generate option.
3. IF the admin submits a PIN that is not exactly 6 numeric digits in the reset dialog, THEN THE Admin_Dashboard SHALL reject the submission and display a validation error.
4. WHEN the admin submits a valid 6-digit PIN via the reset dialog, THE PIN_Service SHALL replace the customer's existing PIN_Hash with the bcrypt hash of the new PIN and set the Temp_PIN_Flag to true.
5. WHEN the Temp_PIN_Flag is set to true after a PIN reset, THE Customer_Portal SHALL force the customer to set a new permanent PIN on the next successful login (same flow as Requirement 2, Acceptance Criteria 3–9).
6. THE PIN_Service SHALL never store or log the admin-entered reset PIN in plaintext after hashing.

### Requirement 8: Forgot PIN Flow (Admin-Assisted)

**User Story:** As a customer who forgot my PIN, I want a clear path to recover access, so that I am not permanently locked out of my account.

#### Acceptance Criteria

1. THE Customer_Portal SHALL display a "Forgot PIN?" link on the PIN entry screen.
2. WHEN a customer activates the "Forgot PIN?" link, THE Customer_Portal SHALL display a message instructing the customer to contact the admin (via phone or clinic visit) to get a new temporary PIN.
3. THE Customer_Portal SHALL NOT provide any self-service PIN reset mechanism (no email link, no SMS code, no security questions) for the "Forgot PIN" flow.
4. WHEN an admin resets a customer's PIN via the Customer_360 view (Requirement 7), THE customer SHALL be able to log in with the new Temporary_PIN and be forced to set a new Permanent_PIN.

### Requirement 9: PIN Storage and Security

**User Story:** As the business owner, I want customer PINs stored securely, so that even a database breach does not expose actual PIN values.

#### Acceptance Criteria

1. THE PIN_Service SHALL hash every PIN using bcrypt (via `bcryptjs`) with a minimum cost factor of 10 before storing it in the database.
2. THE `users` table SHALL store the PIN hash in a `pin_hash` column of type TEXT, which is nullable (null for non-customer users or customers not yet onboarded with a PIN).
3. THE `users` table SHALL store the temporary-PIN flag in an `is_temp_pin` column of type BOOLEAN with a default of true.
4. THE PIN_Service SHALL never write, log, return in an API response, or display a PIN in plaintext after the initial hashing operation.
5. THE PIN_Service SHALL use constant-time comparison (provided by bcrypt's compare function) when verifying a submitted PIN against the stored hash, to prevent timing-based side-channel attacks.
6. THE `pin_hash` and `is_temp_pin` columns SHALL be accessible only through the service-role client and SHALL NOT be exposed to client-side queries or RLS-governed anonymous/authenticated roles.

### Requirement 10: Database Schema Changes for PIN Authentication

**User Story:** As a developer, I want the schema extended to support PIN-based login, so that the PIN hash and temporary flag are persisted alongside existing user data.

#### Acceptance Criteria

1. THE migration script SHALL add a `pin_hash` column (TEXT, nullable) to the `users` table using `ADD COLUMN IF NOT EXISTS` for idempotency.
2. THE migration script SHALL add an `is_temp_pin` column (BOOLEAN, NOT NULL, DEFAULT true) to the `users` table using `ADD COLUMN IF NOT EXISTS` for idempotency.
3. THE migration script SHALL add a `pin_set_at` column (TIMESTAMPTZ, nullable) to the `users` table to record when the PIN was last set or changed.
4. THE migration script SHALL NOT modify or drop the existing `otp_login_throttle` table; the table SHALL be reused as-is for PIN attempt throttling.
5. THE migration script SHALL NOT alter any existing columns or constraints on the `users`, `customer_profiles`, or `otp_login_throttle` tables.
6. THE migration script SHALL follow the project's additive, idempotent migration conventions (header comment, rollback instructions, `IF NOT EXISTS` guards).

### Requirement 11: Session Establishment After PIN Verification

**User Story:** As a developer, I want a clear mechanism to establish an authenticated Supabase session after PIN verification, so that the customer can access protected routes via existing middleware.

#### Acceptance Criteria

1. WHEN PIN verification succeeds (PIN matches and either Temp_PIN_Flag is false, or the customer has just completed the "Set New PIN" flow), THE Auth_Service SHALL establish a Supabase-compatible authenticated session using the customer's `auth_user_id` and the placeholder email + a server-managed password via `signInWithPassword`.
2. THE Auth_Service SHALL maintain the server-managed password for each customer in `auth.users` (set during onboarding via admin API), and this password SHALL NOT be known to or enterable by the customer.
3. WHEN the Auth_Service establishes a session, THE session SHALL be compatible with existing middleware role-checks and route-protection logic so that no middleware changes are required.
4. IF the `signInWithPassword` call fails (e.g., auth identity mismatch or Supabase service error), THEN THE Auth_Service SHALL NOT grant access, SHALL display a generic error message to the customer, and SHALL log the failure for admin investigation.

### Requirement 12: Removal of Supabase Phone Provider Dependency

**User Story:** As the business owner, I want the Supabase phone provider fully decoupled from the login flow, so that no SMS provider configuration or costs are required.

#### Acceptance Criteria

1. THE codebase SHALL NOT import or invoke `supabase.auth.signInWithOtp({ phone: ... })` in any customer-facing login path.
2. THE codebase SHALL NOT import or invoke `supabase.auth.verifyOtp({ phone: ..., token: ..., type: 'sms' })` in any customer-facing login path.
3. WHEN the PIN-based login is deployed, THE system SHALL function correctly without any Supabase phone/SMS provider being configured in the Supabase project settings.
4. THE existing `mobileAuthActions.ts` file (or its replacement) SHALL implement PIN-based authentication actions (`verifyPinAction`, `setPermanentPinAction`) instead of OTP-based actions (`requestOtpAction`, `verifyOtpAction`, `resendOtpAction`).

### Requirement 13: Login UI Changes

**User Story:** As a customer, I want the login screen to clearly show a PIN input (not an OTP input) after I enter my mobile number, so that I know exactly what credentials to provide.

#### Acceptance Criteria

1. THE Customer_Portal login screen SHALL present a single mobile number field as the initial input, with no PIN field visible until the mobile number is submitted and eligibility confirmed.
2. WHEN the eligibility check succeeds, THE Customer_Portal SHALL reveal a PIN entry screen labeled "Enter your PIN" (not "Enter OTP" or "Enter code").
3. THE PIN entry screen SHALL accept input into a single 6-digit numeric field (or six individual digit boxes) with input type restricted to numeric.
4. THE PIN entry screen SHALL display a "Forgot PIN?" link that triggers the flow defined in Requirement 8.
5. THE PIN entry screen SHALL display a "Back" action that returns the customer to the mobile number entry step.
6. WHEN the Temp_PIN_Flag is true and PIN verification succeeds, THE Customer_Portal SHALL navigate to a "Set New PIN" screen with two 6-digit PIN input fields (new PIN + confirm PIN) and a "Set PIN" submit button.
7. THE "Set New PIN" screen SHALL display a clear instruction that the customer must choose a new PIN to continue.

### Requirement 14: Integration with Existing Onboarding Flow

**User Story:** As a developer, I want the PIN-based auth to integrate seamlessly with the existing admin onboarding and profile-completion flows, so that no other onboarding behavior breaks.

#### Acceptance Criteria

1. WHEN the `onboard_customer` RPC is invoked during admin onboarding, THE RPC payload SHALL include the `pin_hash` and `is_temp_pin` values in the `user` object so they are written atomically with the other user fields.
2. THE existing Quick_Onboarding_Form validation (name, mobile, gender, diet, plan, start date, payment, address) SHALL remain unchanged; the Temporary_PIN field is additive only.
3. WHEN a customer with Onboarding_Status IN_PROGRESS logs in via PIN and completes the "Set New PIN" flow, THE Customer_Portal SHALL present the profile-completion dialog on the dashboard (same behavior as the existing flow).
4. THE middleware access-gating logic (role-check, onboarding-status check) SHALL remain unchanged; the only difference is that the session is established via PIN instead of OTP.
5. THE existing `otp_login_throttle` table's `resend_count` and `last_sent_at` columns SHALL be ignored by the PIN-based throttle logic (they are OTP-specific); only `failed_attempts`, `locked_until`, `window_started_at`, and `updated_at` are used.
