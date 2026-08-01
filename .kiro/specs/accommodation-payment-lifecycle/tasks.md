# Implementation Plan: Accommodation Payment Lifecycle

## Overview

Implementation follows the layering the design establishes, bottom-up: the additive idempotent migration (ledger table, `stay_entries` / `payments` columns, the two row-locking RPCs) first, then the pure decision logic inside `AccommodationService` where every balance, status, GST, visibility, and early-checkout property lives, then repositories, service orchestration, Server Actions, the invoice and receipt documents, and finally the two UI surfaces — `QuickOnboardingForm` and the `AccommodationTab` children.

The ordering is deliberate: `deriveStayBalance` and `deriveStayActionVisibility` are built and property-tested before any surface exists that could disagree with them, so "balance is exactly zero" is a settled predicate by the time checkout gating and invoice generation are wired.

Language and stack are fixed by the design and the existing code: TypeScript 5 on Next.js 16 App Router, `plpgsql` for the two RPCs, Vitest 4 + fast-check 4 for tests (both already installed). Everything is additive — `stay_entries`, `AccommodationService`, `stayRepository`, `stayActions`, `AccommodationTab`, and `QuickOnboardingForm` are extended in place, per design decisions 1 and 2.

## Tasks

- [x] 1. Database, types, and validation foundation

  - [x] 1.1 Create `scripts/create-stay-payment-lifecycle.sql`
    - `stay_payment_transactions` table exactly as the design specifies: `transaction_type` CHECK over ADVANCE / PARTIAL_BALANCE_PAYMENT / REFUND, `amount NUMERIC(10,2) CHECK (amount > 0)`, `transaction_date`, `comment`/`remark` VARCHAR(500), `created_by`, `updated_at` trigger, `idx_stay_payment_tx_stay`, `idx_stay_payment_tx_customer`, and the partial unique index `uniq_stay_advance_transaction` enforcing at most one ADVANCE per stay
    - `stay_entries` additive columns: `is_backdated`, `early_checkout_applied`, `actual_nights_stayed`, `original_total_nights`, `original_total_amount`, `checked_out_at`, `final_invoice_payment_id`, `final_invoice_generated_at`, `final_invoice_error`, plus `chk_stay_actual_nights`
    - `payments.stay_entry_id` FK, `idx_payments_stay_entry`, and the partial unique index `uniq_final_stay_invoice_per_stay` on `invoice_type = 'ACCOMMODATION_FINAL_INVOICE'`
    - `record_stay_payment_transaction()` — `SECURITY DEFINER`, `SELECT … FOR UPDATE` on `stay_entries`, derives Total_Paid from the ledger, returns `NOT_FOUND` / `SHARED_PAYMENT` / `AMOUNT_NOT_POSITIVE` / `AMOUNT_EXCEEDS_BALANCE` / `REFUND_EXCEEDS_EXCESS` with the authoritative balance, inserts the row and returns the new totals
    - `finalize_stay_checkout()` — `SECURITY DEFINER`, row-locked, returns `NOT_FOUND` / `NOT_ACTIVE` / `BALANCE_OUTSTANDING`, otherwise sets `status = 'FINISHED'` and `checked_out_at`
    - `stay_payment_balances` reporting view; fully idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`) with an ORDERING section and a Rollback block
    - Existing `payments` rows with `invoice_type IN ('ACCOMMODATION_STAY','ACCOMMODATION_EXTENSION')` left untouched
    - _Requirements: 3.1, 4.5, 5.5, 5.6, 5.8, 6.1, 6.2, 7.3, 7.4, 7.5, 8.1, 8.6, 8.7, 10.1, 12.6, 12.9, 12.11, 12.15_

  - [x] 1.2 Extend `src/types/accommodation.ts`
    - `PaymentTransactionType`, `PAYMENT_TRANSACTION_LABELS` ("Advance" / "Partial / Balance Payment" / "Refund"), `StayPaymentTransaction`, `StayBalanceSnapshot`, `StayActionVisibility`, `StayLedgerView`, `PaymentReceiptData`, `EarlyCheckoutOutcome`
    - Add the lifecycle fields to `StayEntry`: `isBackdated`, `earlyCheckoutApplied`, `actualNightsStayed`, `originalTotalNights`, `originalTotalAmount`, `checkedOutAt`, `finalInvoicePaymentId`, `finalInvoiceGeneratedAt`, `finalInvoiceError`
    - _Requirements: 6.2, 6.3, 8.1, 10.2, 12.6, 12.15_

  - [x] 1.3 Extend `src/validations/accommodationSchema.ts`
    - `accommodationOnboardingSchema`: add `backdatedStayEnabled`, `totalStayAmount` (1–9,999,999), `advanceAmountPaid` (0–9,999,999), and the `superRefine` block covering advance > total, missing total/advance when shared payment is off, past date with the toggle off, past date beyond today − 30, a non-past date with the toggle on, and a start date beyond today + 365
    - `recordStayPaymentSchema` (amount > 0, required trimmed comment ≤ 500, optional remark ≤ 500), `recordStayRefundSchema` (amount > 0, required remark ≤ 500, optional comment), `earlyCheckoutSchema` plus the `createEarlyCheckoutSchema(bookedTotalNights)` factory bounding `actualNightsStayed` to `[1, bookedTotalNights − 1]`
    - Every range enforced server-side regardless of client-side field visibility
    - _Requirements: 1.2, 1.3, 3.4, 3.5, 4.2, 4.3, 4.4, 5.2, 5.3, 5.4, 5.6, 5.7, 12.3, 12.4, 12.5, 12.9, 12.10_

  - [x]* 1.4 Create the shared property-test arbitraries
    - `src/test/accommodation/paymentArbitraries.ts`: `arbMoney` (biased to 0, 1, 9,999,999, 10,000,000 and paise-bearing values), `arbTransaction` across all three types, `arbLedger` (0–20 transactions, including empty and refund-heavy), `arbISTDate`, `arbStartDateAround` (±400 days), `arbStayEntry` (status × `isBackdated` × `earlyCheckoutApplied` × shared-payment combinations), `arbEarlyCheckoutSubmission`
    - _Requirements: 6.3, 10.2, 12.8_

  - [x]* 1.5 Write property test for onboarding payment field validation
    - **Property 5: Onboarding payment field validation**
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - `src/validations/__tests__/accommodationOnboardingPayment.property.test.ts`

  - [x]* 1.6 Write property test for early checkout input validation
    - **Property 20: Early checkout input validation**
    - **Validates: Requirements 12.3, 12.4, 12.5**
    - `src/validations/__tests__/earlyCheckoutSchema.property.test.ts`

  - [x]* 1.7 Write integration tests for the migration and database constraints
    - Migration runs twice with an identical resulting schema and no data change; existing accommodation `payments` rows untouched
    - `uniq_stay_advance_transaction` rejects a second ADVANCE row; `uniq_final_stay_invoice_per_stay` rejects a second final invoice; `amount > 0` and `chk_stay_actual_nights` reject direct out-of-range writes
    - _Requirements: 4.5, 6.1, 8.6, 12.6_

- [x] 2. Money, balance, and decision logic in `AccommodationService`

  - [x] 2.1 Add exact money arithmetic and balance derivation
    - `toPaise` / `fromPaise` and `deriveStayBalance(totalStayAmount, transactions)` returning `totalStayAmount`, `totalPaid`, `remainingBalance` (may be negative), `isFullyPaid` (exact zero in paise), `refundDue = max(0, −remainingBalance)`
    - Order-independent reduction; an empty ledger yields `totalPaid = 0`
    - _Requirements: 6.3, 6.4, 6.7, 7.2_

  - [x]* 2.2 Write property test for balance derivation
    - **Property 1: Balance derivation from the ledger**
    - **Validates: Requirements 6.3, 6.4, 6.7**
    - `src/services/__tests__/AccommodationService.balance.property.test.ts`

  - [x] 2.3 Add the date-range helpers and the backdated status branch
    - `backdatedStayRange(todayIST)` → `[today − 30, today − 1]`, `forwardStayRange(todayIST)` → `[today, today + 365]`
    - Extend `determineInitialStatus` with the FINISHED branch (start date on or before today and `computeEndDate(...) < today`), leaving `VALID_TRANSITIONS` untouched
    - `describeBackdatedStayOutcome` returning `computedEndDate`, `projectedStatus`, and `showCompletionAlert === (projectedStatus === "FINISHED")`
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.3, 2.5, 3.1, 3.2, 3.3_

  - [x]* 2.4 Write property test for start date range gating and toggle reset
    - **Property 2: Start date range gating and toggle reset**
    - **Validates: Requirements 1.2, 1.3, 1.4**
    - `src/services/__tests__/AccommodationService.dateRanges.property.test.ts`

  - [x]* 2.5 Write property test for initial status assignment and the completion alert
    - **Property 3: Initial status assignment and completion alert**
    - **Validates: Requirements 2.1, 2.3, 2.5, 3.1, 3.2, 3.3**
    - `src/services/__tests__/AccommodationService.initialStatus.property.test.ts`

  - [x] 2.6 Drive the GST breakup from the stay's current Total_Stay_Amount
    - A single `gstFromTotal(total)` path used by onboarding, extension, and early checkout so the breakup is always **recomputed** from the current total rather than accumulated per operation
    - _Requirements: 4.8, 8.3, 11.3_

  - [x]* 2.7 Write property test for the GST breakup
    - **Property 7: GST breakup from Total_Stay_Amount**
    - **Validates: Requirements 4.8, 8.3, 11.3**
    - `src/services/__tests__/AccommodationService.gst.property.test.ts`

  - [x] 2.8 Add the action-visibility predicates
    - `deriveStayActionVisibility(stay, balance, hasFinalInvoice, todayIST)` returning `showRecordPayment`, `showFullyPaidMessage`, `showMarkCheckedOut`, `markCheckedOutEnabled`, `showGenerateFinalInvoice`, `showEarlyCheckout`
    - `showMarkCheckedOut` and `showGenerateFinalInvoice` disjoint by construction; shared-payment and zero-total stays treated as non-billable
    - _Requirements: 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1_

  - [x]* 2.9 Write property test for action visibility and mutual exclusivity
    - **Property 10: Stay action visibility and mutual exclusivity**
    - **Validates: Requirements 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1**
    - `src/services/__tests__/AccommodationService.visibility.property.test.ts`

  - [x] 2.10 Add the early-checkout math
    - `computeElapsedNights`, `isEarlyCheckoutEligible`, and `applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions)` returning the new balance plus exactly one `nextStep` of `COLLECT_BALANCE` / `RECORD_REFUND` / `CHECKED_OUT` and the `refundDue`
    - _Requirements: 12.1, 12.6, 12.7, 12.8, 12.12, 12.15_

  - [x]* 2.11 Write property test for early checkout recalculation and branch selection
    - **Property 21: Early checkout recalculation and branch selection**
    - **Validates: Requirements 12.6, 12.7, 12.8, 12.12, 12.15**
    - `src/services/__tests__/AccommodationService.earlyCheckoutMath.property.test.ts`

  - [x] 2.12 Add the payment-history ordering and formatting helper
    - A pure `buildPaymentHistoryRows(transactions)` sorting by (transaction date, creation timestamp) non-decreasing and projecting date, amount, type label from `PAYMENT_TRANSACTION_LABELS`, comment, remark, and the receipt link target for each row
    - _Requirements: 6.2, 6.5, 10.2, 10.3_

  - [x]* 2.13 Write property test for payment history ordering and completeness
    - **Property 9: Payment history ordering and completeness**
    - **Validates: Requirements 6.2, 6.5**
    - `src/services/__tests__/AccommodationService.paymentHistory.property.test.ts`

- [x] 3. Checkpoint - migration and pure logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Repository layer

  - [x] 4.1 Create `src/repositories/stayPaymentRepository.ts`
    - `StayPaymentTransactionRow`, `listTransactionsByStay` (chronological), `getTransactionById`, `recordTransaction` (delegates to `record_stay_payment_transaction`, surfaces the RPC reason and authoritative balance), `insertAdvanceTransaction`
    - Data access only: module-level `*_COLUMNS`, `createAdminClient()` inside each function, no validation, no `"use server"`
    - _Requirements: 5.8, 6.1, 6.2, 6.5, 10.1, 12.11_

  - [x] 4.2 Extend `src/repositories/stayRepository.ts`
    - `applyEarlyCheckout` (sets `total_nights`, `payment_amount`, GST breakup, `actual_nights_stayed`, `early_checkout_applied`, and preserves `original_total_nights` / `original_total_amount` on first application only)
    - `finalizeCheckout` via `finalize_stay_checkout`, `attachFinalInvoice`, `recordFinalInvoiceFailure`, `getStaysByCustomer` (all statuses)
    - Update `extendStay` to **recompute** `base_amount` / `tax_amount` from the updated total and to reject a non-ACTIVE stay defensively
    - _Requirements: 7.3, 8.1, 8.7, 9.2, 11.1, 11.3, 11.5, 12.6, 12.15_

  - [x]* 4.3 Write integration tests for the two RPCs
    - `record_stay_payment_transaction`: two concurrent calls that each individually fit the balance — exactly one succeeds; refund beyond the excess rejected; shared-payment stay rejected
    - `finalize_stay_checkout`: rejects an outstanding balance and a non-ACTIVE status under real constraints
    - Parity: the SQL balance formula (RPC and `stay_payment_balances`) matches `deriveStayBalance` across a seeded set of ledgers
    - _Requirements: 5.5, 6.3, 7.4, 7.5, 12.9_

- [x] 5. Service orchestration

  - [x] 5.1 Extend `AccommodationService.createStay`
    - Accept `totalStayAmount`, `advanceAmountPaid`, `backdatedStayEnabled`; set `payment_amount` to the total, store the GST breakup from that total, set `is_backdated` when the initial status resolves to FINISHED
    - Insert exactly one ADVANCE ledger row iff shared payment is off and the advance is greater than zero; create no ledger row and no total for a shared-payment stay
    - Extend the existing compensating-rollback chain one step so a failed ledger insert unwinds stay → subscription → profile → user → auth identity
    - _Requirements: 3.1, 3.2, 4.5, 4.6, 4.7, 4.8, 6.1_

  - [x]* 5.2 Write property test for the onboarding advance transaction
    - **Property 6: Onboarding creates the advance transaction exactly when due**
    - **Validates: Requirements 4.5, 4.6, 4.7, 6.1**
    - `src/services/__tests__/AccommodationService.createStay.property.test.ts`

  - [x] 5.3 Refine `AccommodationService.extendStay`
    - Increase total nights and Total_Stay_Amount, recompute the GST breakup from the new total, recompute Remaining_Balance against the unchanged Total_Paid, write **no** `payments` row and **no** ledger row, and return the new end date alongside the balance snapshot
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x]* 5.4 Write property test for stay extension folding into the balance
    - **Property 18: Stay extension folds into the running balance**
    - **Validates: Requirements 11.1, 11.2, 11.3**
    - `src/services/__tests__/AccommodationService.extendStay.property.test.ts`

  - [x] 5.5 Implement `checkoutStay` and `generateFinalInvoice`
    - `checkoutStay`: `finalizeCheckout` first, then invoice generation — the status transition is committed before the invoice so FINISHED survives an invoice failure; on failure record `final_invoice_error`, keep FINISHED, and report `PENDING_RETRY`
    - `generateFinalInvoice`: idempotent, returning the existing `paymentId` with `alreadyExisted: true` when one is present; skipped and reported as `NOT_APPLICABLE` for a zero-total or shared-payment stay; links the invoice through `attachFinalInvoice`
    - `earlyCheckout` orchestration: apply the math, persist through `applyEarlyCheckout`, and finalise plus invoice when the recalculated amount already equals Total_Paid
    - Reject extension and early checkout on any non-ACTIVE stay, including one already early-checked-out
    - _Requirements: 7.3, 7.4, 7.5, 8.1, 8.2, 8.6, 8.7, 9.3, 11.5, 12.12, 12.13, 12.14_

  - [x]* 5.6 Write property test for the checkout gate
    - **Property 11: Checkout gate**
    - **Validates: Requirements 7.3, 7.4, 7.5**
    - `src/services/__tests__/AccommodationService.checkout.property.test.ts`

  - [x]* 5.7 Write property test for final invoice idempotence
    - **Property 12: Final invoice idempotence**
    - **Validates: Requirements 8.1, 8.6, 9.3**
    - `src/services/__tests__/AccommodationService.finalInvoiceIdempotence.property.test.ts`

  - [x]* 5.8 Write property test for invoice failure preserving checkout
    - **Property 15: Invoice failure preserves checkout and permits retry**
    - **Validates: Requirements 8.7**
    - `src/services/__tests__/AccommodationService.finalInvoiceFailure.property.test.ts`

  - [x]* 5.9 Write property test for the ACTIVE-status gate
    - **Property 19: Extension and early checkout require an ACTIVE stay**
    - **Validates: Requirements 11.5, 12.14**
    - `src/services/__tests__/AccommodationService.statusGate.property.test.ts`

  - [x]* 5.10 Write the stateful property test over the ledger
    - **Property 23: Ledger consistency across operation sequences**
    - **Validates: Requirements 6.1, 11.6, 12.13**
    - `fc.commands` sequences of advance → payments → extensions → early checkout → refund against an in-memory model of Total_Stay_Amount and Total_Paid, in `src/services/__tests__/stayPaymentLedger.stateful.property.test.ts`

- [x] 6. Checkpoint - repositories and service orchestration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Server Actions

  - [x] 7.1 Create `src/actions/stayPaymentActions.ts`
    - `recordStayPaymentAction`, `recordStayRefundAction`, `getStayPaymentLedgerAction`, `getStayPaymentReceiptAction`
    - Each: admin-group authorisation before any DB access → Zod re-validation → repository/RPC → mapped result, returning the project's `{ success: true; data } | { error; fieldErrors? }` shape
    - Map every RPC reason to its pinned message: `AMOUNT_EXCEEDS_BALANCE` naming the authoritative remaining balance on `fieldErrors.amount`, `REFUND_EXCEEDS_EXCESS` naming the current excess, `SHARED_PAYMENT`, `AMOUNT_NOT_POSITIVE`, `NOT_FOUND`; raw SQL errors never surfaced
    - Every mutation returns a fresh `StayBalanceSnapshot` so the panel can re-render without a second round trip
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.5, 6.6, 10.1, 12.9, 12.10, 12.11_

  - [x]* 7.2 Write property test for Record Payment validation and the ledger append
    - **Property 8: Record Payment validation and ledger append**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.2**
    - `src/actions/__tests__/stayPaymentActions.property.test.ts`

  - [x]* 7.3 Write property test for refund validation and its ledger effect
    - **Property 22: Refund validation and ledger effect**
    - **Validates: Requirements 12.9, 12.10, 12.11**
    - `src/actions/__tests__/stayRefundActions.property.test.ts`

  - [x] 7.4 Extend `src/actions/stayActions.ts`
    - `markStayCheckedOutAction` returning `{ status: "FINISHED"; invoiceStatus }`, rejecting an outstanding balance and a non-ACTIVE stay at the server regardless of client button state
    - `earlyCheckoutStayAction` validating through `createEarlyCheckoutSchema(bookedTotalNights)` and returning the `EarlyCheckoutOutcome` with the `nextStep` the tab must render
    - `extendStayAction` refined to return `{ newEndDate, balance }` and to create no Payment_Transaction
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 11.1, 11.2, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.12, 12.13, 12.14_

  - [x] 7.5 Create `src/actions/stayInvoiceActions.ts`
    - `generateFinalStayInvoiceAction(stayId)` — idempotent, serving checkout, the Backdated_Stay "Generate Final Invoice" action, and the manual retry path after a failure; rejects a stay that is neither a fully-paid Backdated_Stay nor a stay finalised through checkout
    - _Requirements: 8.1, 8.2, 8.6, 8.7, 9.2, 9.3_

  - [x] 7.6 Extend `src/actions/accommodationOnboardingActions.ts`
    - Re-validate the backdated range and the total/advance pair server-side even when the fields were hidden client-side; reject a past start date with the toggle off and a start date earlier than today − 30 with the pinned messages, creating no auth user, user, profile, subscription, stay, or Payment_Transaction
    - Thread `totalStayAmount`, `advanceAmountPaid`, and `backdatedStayEnabled` into `AccommodationService.createStay`
    - _Requirements: 3.4, 3.5, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x]* 7.7 Write property test for server rejection of invalid backdated payloads
    - **Property 4: Server rejection of invalid backdated payloads**
    - **Validates: Requirements 3.4, 3.5**
    - `src/actions/__tests__/accommodationBackdatedOnboarding.property.test.ts`

  - [x]* 7.8 Write unit tests for the non-invoiced checkout paths and the transition table
    - Zero Total_Stay_Amount and shared-payment stays reach FINISHED with no invoice and `invoiceStatus: "NOT_APPLICABLE"`
    - `VALID_TRANSITIONS` unchanged — the FINISHED-at-creation branch is a creation-time assignment, not a transition
    - _Requirements: 3.3, 4.7, 8.2_

- [x] 8. Final invoice branch and payment receipts

  - [x] 8.1 Add the `ACCOMMODATION_FINAL_INVOICE` branch to `src/lib/invoices/index.ts`
    - Branch before the MEAL/KIT/ADDON branching: build the invoice from the linked `stay_entries` row with exactly one line item (`Accommodation Stay — {stay_type} ({occupancy_type})` plus a nights/date subtitle) and no per-transaction detail
    - `nightsForInvoice` / `totalForInvoice` resolve to `actual_nights_stayed` and the recalculated `payment_amount` when `early_checkout_applied`, otherwise to `total_nights` and `payment_amount`; pricing uses the stay's stored 18% GST breakup so the layout matches Meal/KIT
    - _Requirements: 8.3, 8.4, 8.5_

  - [x]* 8.2 Write property test for invoice figures reflecting early checkout
    - **Property 13: Final invoice figures reflect early checkout**
    - **Validates: Requirements 8.3**
    - `src/lib/invoices/__tests__/accommodationFinalInvoice.figures.property.test.ts`

  - [x]* 8.3 Write property test for invoice consolidation
    - **Property 14: Final invoice excludes per-transaction detail**
    - **Validates: Requirements 8.5**
    - `src/lib/invoices/__tests__/accommodationFinalInvoice.consolidation.property.test.ts`

  - [x]* 8.4 Write property test for ledger preservation across invoice generation
    - **Property 17: Invoice generation preserves the ledger**
    - **Validates: Requirements 10.4, 10.5**
    - `src/lib/invoices/__tests__/accommodationFinalInvoice.ledgerPreservation.property.test.ts`

  - [x] 8.5 Build the receipt builder and `PaymentReceiptDocument`
    - A pure `buildPaymentReceiptData(transaction, stay, customer)` producing `receiptNumber` (`RCPT-<first uuid segment, uppercased>`), the type label, and the customer/stay header fields
    - `src/shared/components/shared/invoice/PaymentReceiptDocument.tsx` — printable per-transaction receipt showing amount, date, comment, remark, and the ADVANCE / PARTIAL / REFUND label, following the existing `InvoiceDocument` print conventions
    - _Requirements: 10.1, 10.2, 10.4, 10.5_

  - [x]* 8.6 Write property test for payment receipts
    - **Property 16: Payment receipts are total and correctly labeled**
    - **Validates: Requirements 10.1, 10.2**
    - `src/shared/components/shared/invoice/__tests__/PaymentReceiptDocument.property.test.ts`

  - [x]* 8.7 Write the invoice layout parity snapshot test
    - `InvoiceDocument` rendered with accommodation final-invoice data, compared against the Meal invoice structure to confirm layout and formatting parity
    - _Requirements: 8.4_

- [x] 9. Checkpoint - actions, invoice, and receipts
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Quick Onboard form — backdated toggle and payment split

  - [x] 10.1 Add the Backdated_Stay_Toggle and the completion alert to `QuickOnboardingForm`
    - Checkbox below the stay start date field, rendered only when ACCOMMODATION is the selected primary category, leaving Meal and KIT start-date behaviour untouched
    - Toggle off → `[today, today + 365]`; toggle on → `[today − 30, today − 1]` with today and future dates disabled; unchecking clears an already-selected past date and restores the forward range
    - `describeBackdatedStayOutcome` drives an alert stating the computed end date has passed and the stay will be created FINISHED; the alert updates on change (not on blur), total nights stays editable, and submission is allowed while it is shown
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 10.2 Replace the single payment field with the total/advance split
    - Total stay amount (1–9,999,999, GST-inclusive) and advance amount paid (0 to the entered total) shown for ACCOMMODATION while the shared payment checkbox is unchecked; both hidden while it is checked
    - Client-side rejection of advance > total with the pinned field message; submit the new payload fields to `onboardAccommodationCustomerAction`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7_

  - [x]* 10.3 Write unit tests for the onboarding render conditions
    - Backdated toggle present for ACCOMMODATION and absent for MEAL/KIT; total and advance fields replace the single amount field and disappear under shared payment; alert appears and clears as nights change without leaving the step
    - _Requirements: 1.1, 1.5, 2.2, 2.3, 2.4, 4.1_

- [x] 11. Accommodation tab surfaces

  - [x] 11.1 Build `StayPaymentPanel`
    - Total_Stay_Amount / Total_Paid / Remaining_Balance cards, the chronological payment history list from `buildPaymentHistoryRows` with a receipt link per row, and the fully-paid message when Remaining_Balance is zero
    - Totals re-render from the snapshot returned by every mutation and from a `getStayPaymentLedgerAction` refetch in a `finally` block, so they update whether or not the write succeeded — no page reload
    - _Requirements: 5.1, 5.9, 5.10, 6.5, 6.6, 6.7, 10.3_

  - [x] 11.2 Build `RecordStayPaymentForm`
    - Amount (greater than zero, capped at the current Remaining_Balance), required comment ≤ 500, optional remark ≤ 500, with field-level errors mirroring the server messages
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 11.3 Build `RecordStayRefundDialog`
    - Refund amount prefilled with the excess and bounded to `[1, excess]`, required remark describing how the refund was initiated, optional comment; submits `recordStayRefundAction`
    - _Requirements: 12.8, 12.9, 12.10, 12.11_

  - [x] 11.4 Build `EarlyCheckoutDialog`
    - Actual_Nights_Stayed (integer, `[1, bookedTotalNights − 1]`) and Recalculated_Stay_Amount (1–9,999,999) inputs; routes to the returned `nextStep` — Record Payment while staying ACTIVE, Record Refund with the prefilled excess, or the checked-out confirmation with the invoice outcome
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.12, 12.13_

  - [x] 11.5 Build `StayCheckoutActionBar`
    - "Mark as Checked Out" for an ACTIVE non-backdated stay, disabled until Remaining_Balance is exactly zero and showing the outstanding amount while it is not; "Generate Final Invoice" for a fully-paid Backdated_Stay with no invoice yet; never both, and neither for a FINISHED non-backdated stay
    - Surfaces "Invoice generation failed — retry" wired to `generateFinalStayInvoiceAction` when `final_invoice_error` is set
    - _Requirements: 7.1, 7.2, 8.7, 9.1, 9.2, 9.4_

  - [x] 11.6 Wire `AccommodationTab` to the full stay set
    - Load **all** stays for the customer with a selected-stay notion (a Backdated_Stay is FINISHED at creation yet still needs the payment panel and the invoice action), driven by `getStaysByCustomer`
    - Render the panel, forms, dialogs, and action bar from `deriveStayActionVisibility`; every mutation callback re-runs `getStayPaymentLedgerAction` so totals, nights, and actions update without a page reload, including after a Stay_Extension
    - _Requirements: 5.9, 6.6, 9.1, 9.2, 11.4, 12.7, 12.8_

  - [x] 11.7 Add the payment receipt route
    - `src/app/admin/(main)/customers/[id]/billing/stay-receipt/[transactionId]/page.tsx` as a Server Component: `guardAdminGroup("customers")`, fetch through `getStayPaymentReceiptAction`, render `PaymentReceiptDocument`, `notFound()` on a missing or out-of-scope transaction
    - _Requirements: 10.2, 10.3_

  - [x]* 11.8 Write unit tests for the refresh wiring
    - Ledger refetched after a successful *and* a failed payment and after an extension, with no navigation; receipt link present per history row
    - _Requirements: 5.9, 6.6, 10.3, 11.4_

  - [x]* 11.9 Write end-to-end integration tests for the two headline flows
    - Backdated onboarding with a partial advance: stay is FINISHED, the ledger holds exactly one ADVANCE row, Record Payment is available, and Generate Final Invoice appears only once the balance reaches zero
    - Early checkout with a refund: refund recorded, stay FINISHED, exactly one invoice showing the recalculated amount and actual nights
    - _Requirements: 3.1, 4.5, 9.1, 9.2, 12.11, 12.13_

- [x] 12. Final checkpoint - full suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All 23 correctness properties from the design are covered by exactly one property test each, placed next to the code they constrain; each property test lives in its own file so the suite parallelises cleanly
- Property tests run at least 100 iterations (`fc.assert(..., { numRuns: 100 })`) and carry the tag `Feature: accommodation-payment-lifecycle, Property {number}: {title}`
- `Total_Paid` and `Remaining_Balance` are never persisted — every read derives them from the ledger, and every balance-mutating write goes through a row-locking RPC, so no code path can leave a stored balance stale
- Money comparisons happen in integer paise inside the service layer; "balance is exactly zero" is only ever evaluated there
- This spec is additive over `accommodation-customer-flow`. It extends `stay_entries`, `AccommodationService`, `stayRepository`, `stayActions`, `AccommodationTab`, and `QuickOnboardingForm` in place; tasks 12 and 13 of that spec's plan (admin Accommodation tab surfaces) remain its own scope and are only touched here through the payment panel wiring in task 11.6
- Per design decision 7, accommodation stays no longer write a `payments` row at onboarding or extension; revenue is recognised once, at checkout. Existing `ACCOMMODATION_STAY` / `ACCOMMODATION_EXTENSION` rows are left untouched for historical accuracy
- The migration is idempotent and carries a Rollback block, so re-running is always safe

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "4.2"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.6", "2.2", "2.3", "4.1"] },
    { "id": 3, "tasks": ["1.7", "2.4", "2.5", "2.6", "4.3"] },
    { "id": 4, "tasks": ["2.7", "2.8", "8.1"] },
    { "id": 5, "tasks": ["2.9", "2.10", "8.2", "8.5"] },
    { "id": 6, "tasks": ["2.11", "2.12", "8.3", "8.6"] },
    { "id": 7, "tasks": ["2.13", "5.1", "8.4", "8.7"] },
    { "id": 8, "tasks": ["5.2", "5.3", "7.1"] },
    { "id": 9, "tasks": ["5.4", "5.5", "7.2", "7.3", "7.6", "10.1"] },
    { "id": 10, "tasks": ["5.6", "5.7", "5.8", "5.9", "5.10", "7.4", "7.5", "7.7", "10.2"] },
    { "id": 11, "tasks": ["7.8", "10.3", "11.1", "11.2", "11.3", "11.4", "11.5", "11.7"] },
    { "id": 12, "tasks": ["11.6"] },
    { "id": 13, "tasks": ["11.8", "11.9"] }
  ]
}
```
