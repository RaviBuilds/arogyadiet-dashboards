# Implementation Plan: Accommodation Payment Lifecycle

## Overview

Implementation follows the layering the design establishes, bottom-up: the additive idempotent migration (ledger table, `stay_entries` / `payments` columns, the two row-locking RPCs) first, then the pure decision logic inside `AccommodationService` where every balance, status, GST, visibility, and early-checkout property lives, then repositories, service orchestration, Server Actions, the invoice and receipt documents, and finally the two UI surfaces — `QuickOnboardingForm` and the `AccommodationTab` children.

The ordering is deliberate: `deriveStayBalance` and `deriveStayActionVisibility` are built and property-tested before any surface exists that could disagree with them, so "balance is exactly zero" is a settled predicate by the time checkout gating and invoice generation are wired.

Language and stack are fixed by the design and the existing code: TypeScript 5 on Next.js 16 App Router, `plpgsql` for the two RPCs, Vitest 4 + fast-check 4 for tests (both already installed). Everything is additive — `stay_entries`, `AccommodationService`, `stayRepository`, `stayActions`, `AccommodationTab`, and `QuickOnboardingForm` are extended in place, per design decisions 1 and 2.

### Revision 2 (tasks 13–24)

Tasks 1–12 below are **complete and shipped**. A second revision follows them, starting at task 13, covering the design's *Revision 2* section: Recalculate Stay / Save Stay Details decoupled from checkout, Recalculation History, and the Refund_Invoice. It is a **delta over running code**, not greenfield — most tasks refactor or replace a shipped symbol rather than adding beside it, and each such task names the symbol it retires so no second code path is left behind. Nothing in tasks 1–12 is re-opened, renumbered, or undone.

The one new migration, `scripts/create-stay-recalculation.sql`, is additive and idempotent in the same style as the first: it adds a recalculation history table, the `recalculation_applied` column plus its backfill, refund-invoice linkage columns, a widened `payments.invoice_type` CHECK, and two new RPCs. Nothing is dropped.

Ordering repeats the first revision's bottom-up spirit: migration → types → validation → pure service logic (with its property tests placed before the surfaces that could disagree with them) → repositories → service orchestration → server actions → invoice/document layer → UI → final checkpoint.

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

### Revision 2 Delta — Recalculate Stay, Recalculation History, Refund Invoice

Tasks 13–24 implement the design's *Revision 2* section on top of the shipped tasks 1–12. Scope is fixed by the design's **Scoping Note for the Task List**: nothing below touches `stay_payment_transactions`' schema, `record_stay_payment_transaction`'s ADVANCE/PARTIAL path, `finalize_stay_checkout`, `deriveStayBalance`, `gstFromTotal`, `determineInitialStatus`, onboarding, the payment history list, or `PaymentReceiptDocument`. Shipped tests that still pass unchanged stay unchanged.

- [x] 13. Recalculation migration

  - [x] 13.1 Create `scripts/create-stay-recalculation.sql`
    - **New, additive, idempotent — nothing is dropped.** Runs AFTER `create-accommodation-tables.sql`, `create-stay-payment-lifecycle.sql`, and `create-stay-extension-history.sql`; carries an ORDERING header and a Rollback block matching the other scripts
    - `stay_entries.recalculation_applied BOOLEAN NOT NULL DEFAULT false`, plus the one-time backfill `SET recalculation_applied = true WHERE early_checkout_applied = true` so already-shipped early-checkout stays keep printing recalculated figures. `early_checkout_applied` / `actual_nights_stayed` / `original_total_*` are **retained**, not dropped — only their roles narrow
    - `stay_recalculation_history` table (own table, NOT a discriminator on `stay_extension_history`): `nights_before` / `nights_after` (`CHECK >= 1`), `total_amount_before` / `total_amount_after`, `end_date_before` / `end_date_after`, `recalculated_on`, `created_by`, plus `chk_stay_recalc_changed` enforcing that a row exists only when nights or amount actually changed; `idx_stay_recalc_history_stay` on `(stay_entry_id, created_at)` and `idx_stay_recalc_history_customer`
    - Refund-invoice linkage: `payments.stay_payment_transaction_id` FK, `stay_payment_transactions.refund_invoice_payment_id` FK back-reference, `idx_payments_stay_payment_tx`, and the partial unique index `uniq_refund_invoice_per_transaction` keyed on the **transaction** (any number of Refund_Invoices per stay, at most one per REFUND row)
    - Widen `payments_invoice_type_check` to admit `ACCOMMODATION_REFUND_INVOICE` while keeping every pre-existing value admissible, including `ACCOMMODATION_FINAL_INVOICE`
    - `save_stay_details()` — `SECURITY DEFINER`, `SET search_path = public`, one `SELECT … FOR UPDATE` on `stay_entries`: rejects `NOT_FOUND` / `NOT_ACTIVE` / `INVALID_END_DATE` (returning the valid `[start_date, start_date + total_nights − 1]` bounds) / `AMOUNT_OUT_OF_RANGE` (non-integer or outside 1–9,999,999); otherwise sets `total_nights = end − start + 1`, `payment_amount`, the GST breakup, `recalculation_applied = true`, `early_checkout_applied OR shortens`, `actual_nights_stayed` for the shortening case only, and `COALESCE`-pins `original_total_nights` / `original_total_amount` on first application; inserts the history row in the **same transaction** iff something changed. It deliberately never touches `status`, `checked_out_at`, or `payments`
    - `record_stay_refund_with_invoice()` — `SECURITY DEFINER`, row-locked: rejects `NOT_FOUND` / `SHARED_PAYMENT` / `NOT_ACTIVE` / `AMOUNT_NOT_POSITIVE` / `NO_EXCESS_TO_REFUND` / `REFUND_EXCEEDS_EXCESS` (returning the live excess) / `REMARK_INVALID`; otherwise inserts the REFUND ledger row, inserts the `ACCOMMODATION_REFUND_INVOICE` `payments` row, and links `refund_invoice_payment_id` back — all in one transaction, so an invoice failure rolls the REFUND row back with it
    - _Requirements: 8.4, 12.8, 12.14, 12.15, 12.16, 13.1, 13.2, 13.5, 13.6, 13.7, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

  - [ ]* 13.2 Write integration tests for the recalculation migration and its constraints
    - `src/test/accommodation/recalculationMigration.integration.test.ts`: the script runs **twice** with an identical resulting schema and no data change beyond the one-time `recalculation_applied` backfill; every pre-existing `payments.invoice_type` value remains admissible after the widened CHECK
    - `chk_stay_recalc_changed` rejects a direct insert where neither nights nor amount changed; `uniq_refund_invoice_per_transaction` rejects a second Refund_Invoice for one REFUND transaction while accepting several for the same stay
    - `save_stay_details()` under real constraints: rejects a non-ACTIVE stay, a date after the booked end date, a date before the start date, and a fractional amount; **accepts the start date itself, yielding exactly 1 night**; writes zero history rows for a full no-op; leaves the stay byte-identical when its history insert is forced to fail
    - `record_stay_refund_with_invoice()` under real constraints: the REFUND row and its `payments` row appear together, and with the invoice insert forced to fail neither exists and Total_Paid is unchanged
    - _Requirements: 8.4, 12.16, 13.2, 14.8, 14.9_

- [x] 14. Types and validation for Recalculate Stay

  - [x] 14.1 Extend `src/types/accommodation.ts` for the recalculation delta
    - Add `recalculationApplied` to `StayEntry`; mark `actualNightsStayed` `@deprecated` (kept in sync, no longer read) and document `earlyCheckoutApplied`'s narrowed meaning ("ended earlier than booked")
    - Add `StayRecalculation` and `RecalculationHistoryRow`; add `recalculations: StayRecalculation[]` to `StayLedgerView` beside the existing `extensions`
    - Add `SaveStayDetailsOutcome` — **replaces `EarlyCheckoutOutcome`, which is deleted, not deprecated.** It has no `CHECKED_OUT` member and no `invoiceStatus` field, `nextAction` is `"COLLECT_BALANCE" | "RECORD_REFUND" | "SETTLED"`, and `status` is the literal `"ACTIVE"`, so no value of the type can express "and the stay was also checked out"
    - `StayActionVisibility`: `showEarlyCheckout` → `showRecalculateStay` (the old field name is removed), plus the new `showMarkAsRefunded`
    - `refund_invoice_payment_id` reflected on the transaction row type
    - _Requirements: 8.4, 12.9, 12.12, 12.15, 13.3, 13.5, 14.1, 14.7_

  - [x] 14.2 Replace the early-checkout schemas in `src/validations/accommodationSchema.ts`
    - Add `recalculateStaySchema` (`recalculatedEndDate` as a `YYYY-MM-DD` string, `recalculatedStayAmount` as `.int()` in `[1, MAX_STAY_AMOUNT]` with the whole-number message) and the `createRecalculateStaySchema(startDate, bookedEndDate)` factory bounding the date to the **inclusive** `[startDate, bookedEndDate]` range with `<` / `>` comparisons so both bounds are selectable
    - **`earlyCheckoutSchema` and `createEarlyCheckoutSchema` are removed**, along with the `[1, bookedTotalNights − 1]` night-count bound and its one-night carve-out comment. The night count leaves the payload entirely — it is derived from the date server-side. Do **not** reintroduce a `start + 1 day` minimum or a 2-night minimum: the start date itself is valid and yields exactly 1 night, and for a 1-night stay the range collapses to that single date
    - No unchanged-date carve-out is needed — the current end date is inside the bounds by construction, so a no-op submission passes the plain check
    - Used on both client and server so acceptance is identical either side
    - _Requirements: 12.3, 12.4, 12.5, 12.6_

  - [ ]* 14.3 Rework the shared property-test arbitraries for the recalculation payload
    - `src/test/accommodation/paymentArbitraries.ts`: `arbEarlyCheckoutSubmission` → `arbRecalculateStaySubmission` (candidate end dates spanning ±400 days, biased to `startDate − 1`, `startDate`, `bookedEndDate`, `bookedEndDate + 1`; amounts biased to fractions, 0, 1, 9,999,999, 10,000,000); `arbStayEntry` gains `recalculationApplied` and a deliberately **stale** `actualNightsStayed`; add `arbStayRecalculation` and an arbitrary for interleaved extension/recalculation sequences
    - _Requirements: 12.3, 12.4, 13.1_

  - [ ]* 14.4 Write property test for Recalculate Stay input validation
    - **Property 20: Recalculate Stay input validation**
    - **Validates: Requirements 12.3, 12.4, 12.5, 12.6**
    - `src/validations/__tests__/recalculateStaySchema.property.test.ts` — **replaces** `src/validations/__tests__/earlyCheckoutSchema.property.test.ts`, which is deleted with its subject. Must assert the start date is accepted (1 night), `startDate − 1` and `bookedEndDate + 1` are rejected, all four change combinations of Req 12.6 are accepted, and a 1-night stay's single date is valid

- [x] 15. Pure recalculation logic in `AccommodationService`

  - [x] 15.1 Add the nights↔end-date conversion helpers
    - `nightsFromEndDate(startDate, endDate)` = `differenceInDays(end, start) + 1` (inclusive, the inverse of `computeEndDate`), `endDateFromNights` as the named alias of `computeEndDate`, and `recalculationDateBounds(stay)` returning `{ min: stay.startDate, max: endDateFromNights(stay.startDate, stay.totalNights) }`
    - The bounds are never empty and there is **no availability flag** to return — for a 1-night stay `min === max === startDate`. Do not add a `dateChangeAvailable` field or any 1-night special case
    - _Requirements: 12.3, 12.8_

  - [ ]* 15.2 Write property test for the nights↔date inverse pair and picker bounds
    - **Property 25: End-date and nights conversion is a faithful inverse pair within the picker bounds**
    - **Validates: Requirements 12.3, 12.8**
    - `src/services/__tests__/AccommodationService.recalculationDates.property.test.ts`

  - [x] 15.3 Add `applyStayRecalculationMath` and `isRecalculationEligible`
    - `applyStayRecalculationMath(stay, recalculatedEndDate, recalculatedStayAmount, transactions)` returning `totalNights` (derived from the date), `balance`, exactly one `nextAction` of `COLLECT_BALANCE` / `RECORD_REFUND` / `SETTLED`, `refundDue`, `changesSomething` (nights or amount differ, compared in integer paise), and `shortensStay`
    - **Replaces `applyEarlyCheckoutMath`, which is removed** — along with its `CHECKED_OUT` branch and every invoice decision. There is no branch anywhere in this function that checks a stay out
    - **`isRecalculationEligible` replaces `isEarlyCheckoutEligible`**: ACTIVE + billable, with the `earlyCheckoutApplied` clause **dropped** (recalculation is repeatable) and no elapsed-nights clause
    - _Requirements: 12.8, 12.9, 12.10, 12.11, 12.12, 13.1, 13.2_

  - [ ]* 15.4 Write property test for Save Stay Details recalculation and follow-up selection
    - **Property 21: Save Stay Details recalculation and follow-up selection**
    - **Validates: Requirements 12.8, 12.10, 12.11, 12.12, 12.15**
    - `src/services/__tests__/AccommodationService.recalculationMath.property.test.ts` — **replaces** `AccommodationService.earlyCheckoutMath.property.test.ts`. Sequences of 1–5 valid submissions; originals stay pinned to their pre-first-submission values; no submission ever reports a checkout

  - [x] 15.5 Apply the three `deriveStayActionVisibility` deltas
    - `showEarlyCheckout` → `showRecalculateStay` = `ACTIVE && billable`, **removing** the `!stay.earlyCheckoutApplied` clause and any elapsed-nights clause
    - New `showMarkAsRefunded` = `ACTIVE && billable && balance.refundDue > 0`, derived from the balance rather than from "a recalculation just happened", so it survives a reload
    - `markCheckedOutEnabled` keeps its existing `balance.isFullyPaid && todayIST >= stay.endDate` formula unchanged — `stay.endDate` already derives from `total_nights`, which Save Stay Details replaces, so the recalculated date flows into the existing gate. Update the doc comment and add no new branch
    - _Requirements: 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1, 12.10, 12.11, 12.12, 12.13, 14.1_

  - [ ]* 15.6 Update the property test for action visibility and mutual exclusivity
    - **Property 10: Stay action visibility and mutual exclusivity**
    - **Validates: Requirements 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1, 12.10, 12.11, 12.12, 12.13, 14.1**
    - Revise the existing `src/services/__tests__/AccommodationService.visibility.property.test.ts`: sample `recalculationApplied` and `todayIST` relative to the current end date (before / on / after), assert `showRecalculateStay` is independent of prior recalculation, and assert the enablement date moves with a shortened stay

  - [ ]* 15.7 Update the property test for the GST breakup
    - **Property 7: GST breakup from Total_Stay_Amount**
    - **Validates: Requirements 4.8, 11.3, 8.3**
    - Revise the existing `src/services/__tests__/AccommodationService.gst.property.test.ts` so the invariant is asserted after *any number of* Save Stay Details submissions replace the total, not just after one early checkout

  - [x] 15.8 Add the recalculation-history row builder
    - `src/lib/accommodation/recalculationHistory.ts`: a pure `buildRecalculationHistoryRows(recalculations)` sorting **ascending** by (recorded date, creation timestamp) — oldest first — and projecting date, nights before/after, and Total_Stay_Amount before/after into `RecalculationHistoryRow`; an empty input yields an empty array so the card can render its empty state
    - Client-safe (no repository or Supabase imports) so the card can import it directly, matching `lib/accommodation/backdatedStay.ts`
    - _Requirements: 13.4, 13.5_

  - [ ]* 15.9 Write property test for recalculation history ordering and completeness
    - **Property 27: Recalculation history ordering and completeness**
    - **Validates: Requirements 13.4, 13.5**
    - `src/lib/accommodation/__tests__/recalculationHistory.property.test.ts`

- [x] 16. Checkpoint - migration, types, and pure recalculation logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Repository layer for recalculation and the refund invoice

  - [x] 17.1 Replace `applyEarlyCheckout` with `saveStayDetails` in `src/repositories/stayRepository.ts`
    - `saveStayDetails({ stayId, recalculatedEndDate, recalculatedTotalNights, recalculatedStayAmount, gst, recalculatedOn, createdBy })` delegating to the `save_stay_details()` RPC, returning `{ ok: true; stay; historyRecorded }` or the typed reason union `NOT_FOUND` / `NOT_ACTIVE` / `INVALID_END_DATE` (with `minEndDate` / `maxEndDate`) / `AMOUNT_OUT_OF_RANGE` — business outcomes returned, not thrown, matching `finalizeCheckout`
    - **`applyEarlyCheckout` is removed**, not left beside the new function: its plain unlocked UPDATE is exactly what Req 12.16 forbids, and its only caller is itself being replaced. Add `recalculation_applied` to `STAY_ENTRY_COLUMNS`
    - _Requirements: 12.8, 12.14, 12.15, 12.16, 13.1, 13.2_

  - [x] 17.2 Add `recordRefundWithInvoice` to `src/repositories/stayPaymentRepository.ts`
    - Delegates to `record_stay_refund_with_invoice()`, returning the transaction, `refundInvoicePaymentId`, and the authoritative totals, or the typed reason union; add `refund_invoice_payment_id` to `StayPaymentTransactionRow` and the module's column list
    - `recordTransaction` keeps its REFUND branch untouched for legacy/direct invocation, but **no application path may call it with `'REFUND'` any more** — every refund goes through the new function so the invoice can never be orphaned from its ledger row
    - _Requirements: 14.6, 14.7, 14.8_

  - [x] 17.3 Create `src/repositories/stayRecalculationHistoryRepository.ts`
    - Read-only, mirroring `stayExtensionHistoryRepository`'s layering, admin client, and conventions: `StayRecalculationHistoryRow` and `listRecalculationsByStay(stayEntryId)` ascending by `created_at`, empty array for the empty state
    - **Deliberately no write function** — the history row is inserted inside `save_stay_details()` so it shares that transaction; a Node-side insert could succeed after the stay update failed, which is what Req 12.16 forbids
    - _Requirements: 13.3, 13.4, 13.5_

  - [ ]* 17.4 Write integration tests for the two new RPCs through the repositories
    - `saveStayDetails`: each reason mapped correctly under real constraints; a no-op submission returns `historyRecorded: false` with zero history rows; `original_total_*` pinned across repeated submissions
    - `recordRefundWithInvoice`: ledger row and `payments` row committed together; forced invoice failure leaves neither and Total_Paid unchanged; a second Refund_Invoice for the same transaction is impossible
    - _Requirements: 12.16, 13.2, 14.8, 14.9_

- [x] 18. Service orchestration for Save Stay Details and the refund

  - [x] 18.1 Replace `AccommodationService.earlyCheckout` with `saveStayDetails`
    - Fetch the stay, reject a non-ACTIVE one, run `applyStayRecalculationMath`, recompute the GST breakup from the new total through the single `gstFromTotal` path, delegate the whole write to `stayRepository.saveStayDetails`, and return `SaveStayDetailsOutcome` with `status: "ACTIVE"` and `historyRecorded`
    - **`earlyCheckout` is removed.** The new function does **not** call `checkoutStay` and does **not** call `generateFinalInvoice` — that decoupling is the point of the revision. Repeatable while ACTIVE
    - _Requirements: 12.8, 12.9, 12.10, 12.14, 12.16, 13.1, 13.2_

  - [ ]* 18.2 Write property test for Save Stay Details never transitioning status or invoicing
    - **Property 24: Save Stay Details never transitions status and never invoices**
    - **Validates: Requirements 12.9, 12.13**
    - `src/services/__tests__/AccommodationService.saveStayDetailsNoTransition.property.test.ts` — include a generator arm that deliberately constructs the settled, end-date-reached state the old code would have checked out

  - [ ]* 18.3 Write property test for Save Stay Details atomicity under failure
    - **Property 30: Save Stay Details is atomic under failure**
    - **Validates: Requirements 12.16**
    - `src/services/__tests__/AccommodationService.saveStayDetailsAtomicity.property.test.ts` — failure injected at each distinguishable step, deep-equality snapshot of the stay row and both history tables, then an unimpeded retry

  - [ ]* 18.4 Write property test for recalculation history recording and non-crossover
    - **Property 26: Recalculation history is recorded exactly when something changed, and never crosses over**
    - **Validates: Requirements 13.1, 13.2, 13.6, 13.7**
    - `src/services/__tests__/AccommodationService.recalculationHistory.property.test.ts` — interleaved extension/recalculation sequences including no-ops and amounts equal in paise but different as floats

  - [x] 18.5 Add `AccommodationService.recordRefundWithInvoice`
    - Thin wrapper over `stayPaymentRepository.recordRefundWithInvoice` returning `{ ok: true; balance; refundInvoicePaymentId; transactionId }` or the reason union. **No Node-side compensating delete** — the atomicity lives in the RPC, because a compensating delete is itself a write that can fail
    - Never writes `status` or `checked_out_at`: a refund that settles the balance only makes the stay *eligible* for Mark as Checked Out
    - _Requirements: 14.1, 14.6, 14.7, 14.8, 14.10_

  - [ ]* 18.6 Write property test for the Refund_Invoice bijection
    - **Property 28: Exactly one Refund_Invoice per REFUND transaction**
    - **Validates: Requirements 14.6, 14.7, 14.9**
    - `src/services/__tests__/AccommodationService.refundInvoice.property.test.ts` — sequences of 1–5 accepted refunds against overpaid stays; assert the ledger↔invoice bijection, per-invoice content, many-per-stay, and that a second invoice for one transaction is impossible

  - [ ]* 18.7 Write property test for the refund rollback on invoice failure
    - **Property 29: A failed Refund_Invoice rolls the refund back**
    - **Validates: Requirements 14.8**
    - `src/services/__tests__/AccommodationService.refundRollback.property.test.ts` — deep-equality snapshot of the ledger before/after the forced failure, then a successful submission once the condition clears

  - [ ]* 18.8 Update the property test for refund validation and ledger effect
    - **Property 22: Refund validation, ledger effect, and checkout eligibility**
    - **Validates: Requirements 14.2, 14.3, 14.4, 14.5, 14.6, 14.10**
    - Revise the existing `src/actions/__tests__/stayRefundActions.property.test.ts`: acceptance now depends only on the live excess (no preceding recalculation), covers excess ≤ 0 as `NO_EXCESS_TO_REFUND`, amounts at 0 / 1 / excess / excess + 0.01, remarks at 0 / 1 / 500 / 501 chars, and asserts `Stay_Status` and `checked_out_at` are untouched while a full-excess refund leaves the balance exactly zero

  - [ ]* 18.9 Update the property test for the ACTIVE-status gate
    - **Property 19: Extension and Save Stay Details require an ACTIVE stay**
    - **Validates: Requirements 11.5, 12.14**
    - Revise the existing `src/services/__tests__/AccommodationService.statusGate.property.test.ts`: Save Stay Details replaces Early_Checkout, and **both** history tables are added to the set asserted unchanged

  - [ ]* 18.10 Update the stateful property test over the ledger
    - **Property 23: Ledger consistency across operation sequences**
    - **Validates: Requirements 6.1, 11.6, 12.9, 12.13**
    - Revise the existing `src/services/__tests__/stayPaymentLedger.stateful.property.test.ts`: `fc.commands` sequences of advance → payments → extensions → **repeated Save Stay Details** → refunds → checkout, with the in-memory model additionally tracking nights and status and asserting the stay stays ACTIVE until the explicit checkout command

- [x] 19. Checkpoint - repositories and service orchestration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Server actions

  - [x] 20.1 Replace `earlyCheckoutStayAction` with `saveStayDetailsAction` in `src/actions/stayActions.ts`
    - Admin auth → fetch the stay for its `startDate` and booked end date → validate through `createRecalculateStaySchema(startDate, bookedEndDate)` → delegate to `AccommodationService.saveStayDetails` → return `SaveStayDetailsOutcome`
    - **`earlyCheckoutStayAction` and its `createEarlyCheckoutSchema` import are removed**, so no caller can reach the old contract. Map `INVALID_END_DATE` / `AMOUNT_OUT_OF_RANGE` / `NOT_ACTIVE` to their pinned field-level messages, naming the valid bounds
    - `markStayCheckedOutAction`'s date-gate comment updated to point at Recalculate Stay rather than Early Checkout; its logic is unchanged, since it already reads the recalculated end date via `total_nights`
    - _Requirements: 12.5, 12.8, 12.9, 12.10, 12.14, 12.16_

  - [x] 20.2 Refactor `recordStayRefundAction` in `src/actions/stayPaymentActions.ts`
    - Route through `AccommodationService.recordRefundWithInvoice` instead of the generic `record_stay_payment_transaction` path, and return `{ balance, refundInvoicePaymentId }` so the dialog can link straight to the generated Refund_Invoice
    - Map `NO_EXCESS_TO_REFUND`, `REFUND_EXCEEDS_EXCESS` (naming the live excess on `fieldErrors.amount`), `REMARK_INVALID`, `NOT_ACTIVE`, `SHARED_PAYMENT`, and `INVOICE_FAILED` ("The refund could not be completed — no change was made. Please try again.") to their pinned messages; no raw SQL error surfaces
    - Callable whenever the ACTIVE stay is overpaid — no longer gated on a preceding recalculation
    - _Requirements: 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 20.3 Thread `recalculations` through `getStayPaymentLedgerAction`
    - Populate `StayLedgerView.recalculations` from `stayRecalculationHistoryRepository.listRecalculationsByStay` in the **same round trip** that already returns `extensions`, so both history cards render from one fetch. No separate action is introduced
    - _Requirements: 13.3, 13.5_

  - [x] 20.4 Add the `manualRetrigger` refinement to `generateFinalStayInvoiceAction`
    - `opts?: { manualRetrigger?: boolean }`. Internal invocations keep the idempotent `{ paymentId, alreadyExisted: true }` behaviour; an explicit manual retrigger against a stay that already has an invoice returns the error "A final invoice already exists for this stay." Either way no second `payments` row is written
    - _Requirements: 8.7, 8.9, 8.10_

  - [ ]* 20.5 Update the property test for final invoice idempotence
    - **Property 12: Final invoice idempotence**
    - **Validates: Requirements 8.1, 8.7, 8.10, 9.3**
    - Revise the existing `src/services/__tests__/AccommodationService.finalInvoiceIdempotence.property.test.ts`: repeated invocation counts × random `manualRetrigger` flags, asserting internal calls succeed idempotently while a manual retrigger over an existing invoice errors

  - [ ]* 20.6 Update the property test for invoice failure preserving checkout
    - **Property 15: Invoice failure preserves checkout and permits retry**
    - **Validates: Requirements 8.8, 8.9**
    - Revise the existing `src/services/__tests__/AccommodationService.finalInvoiceFailure.property.test.ts` for the renumbered criteria and the explicit **manual** retry path, across 1–3 consecutive injected failures

  - [ ]* 20.7 Write the structural regression unit test
    - A source-level assertion that `status = 'FINISHED'` is written by exactly two places — `finalize_stay_checkout()` and the creation-time backdated branch — and that no production call site passes `'REFUND'` to `record_stay_payment_transaction`
    - Also assert the retired symbols are gone: no reference remains to `earlyCheckoutStayAction`, `applyEarlyCheckoutMath`, `applyEarlyCheckout`, `createEarlyCheckoutSchema`, or `EarlyCheckoutOutcome`
    - _Requirements: 12.9, 12.13, 14.8_

- [x] 21. Invoice and document layer

  - [x] 21.1 Correct the final-invoice figures resolution in `src/lib/invoices/index.ts`
    - **Replace** the shipped `early_checkout_applied ? actual_nights_stayed : total_nights` ternary with the unconditional live columns: `nightsForInvoice = stay.total_nights`, `totalForInvoice = payment.amount`. `actual_nights_stayed` is no longer read at all — repeatable recalculation makes it stale
    - `recalculation_applied` is still read, but now drives **presentation only** (labelling the figures as recalculated and selecting the subtitle wording), never value selection
    - _Requirements: 8.3, 8.4_

  - [ ]* 21.2 Update the property test for invoice figures
    - **Property 13: Final invoice figures reflect early checkout**
    - **Validates: Requirements 8.3, 8.4**
    - Revise the existing `src/lib/invoices/__tests__/accommodationFinalInvoice.figures.property.test.ts`: every generated stay carries a deliberately **stale** `actual_nights_stayed` that must never surface, across stays with and without `recalculation_applied`

  - [x] 21.3 Add the `ACCOMMODATION_REFUND_INVOICE` branch to `src/lib/invoices/index.ts`
    - A second branch beside the final-invoice one, in the same early block before any ADDON/KIT/MEAL branching. Reads the linked REFUND `stay_payment_transactions` row, not the stay's totals: one line item `Accommodation Stay Refund — {stay_type} ({occupancy_type})` with a `Refund dated {transaction_date} · {remark}` subtitle and the transaction's amount
    - `invoiceNumber` is `RFND-<first uuid segment, uppercased>`, visibly distinct from the final invoice's `INV-…`. It shows nothing about Total_Stay_Amount, Total_Paid, or any other transaction; existing GST columns carry through for layout parity. Served by the existing `/admin/customers/[id]/billing/invoice/[paymentId]` route — no new page
    - _Requirements: 14.7_

  - [ ]* 21.4 Write unit tests for the refund invoice render branch
    - `src/lib/invoices/__tests__/accommodationRefundInvoice.property.test.ts`: the rendered Refund_Invoice shows its own transaction's amount, remark, and date plus a stay reference, and no other transaction's figures; the `RFND-` number never collides with an `INV-` number; several Refund_Invoices for one stay each render their own figures
    - _Requirements: 14.7, 14.9_

- [x] 22. Checkpoint - actions and invoice layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. UI surfaces

  - [x] 23.1 Build `RecalculateStayDialog`, rebuilding `EarlyCheckoutDialog`
    - `src/shared/components/admin/customers/RecalculateStayDialog.tsx`: a `react-day-picker` calendar bounded by `recalculationDateBounds` with `disabled` covering everything outside the inclusive `[start date, booked end]` range, a **read-only derived "Total nights: N" line** that updates as the date changes (nights are never typed), and an integer-only amount input (`step=1`, `inputMode="numeric"`), both prefilled from the stay's current Computed_End_Date and Total_Stay_Amount
    - Primary button reads **"Save Stay Details"**; the dialog renders no checkout affordance and no checked-out confirmation of any kind. On success it routes on `nextAction` — Record Payment, Mark as refunded, or nothing
    - The picker is always enabled: the bounds are never empty, and for a 1-night stay they collapse to the single selectable start date. Do **not** carry over the old `[1, bookedTotalNights − 1]` copy, the "must be less than the currently booked N nights" hint, or any 1-night rejection path
    - **Delete `EarlyCheckoutDialog.tsx`** once `AccommodationTab` no longer imports it (task 23.5)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.11, 12.12_

  - [x] 23.2 Build `StayRecalculationHistoryCard`
    - `src/shared/components/admin/customers/StayRecalculationHistoryCard.tsx`, styled identically to the existing Extension History card and sitting beside it inside `StayPaymentPanel`. Ascending, oldest first, from `buildRecalculationHistoryRows(ledger.recalculations)`; each row shows the date, `nights before → after`, and `amount before → after`; explicit empty state "No recalculations recorded for this stay."
    - Reads **only** `ledger.recalculations`; the Extension History card is left untouched and continues to read only `ledger.extensions`
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 23.3 Promote `RecordStayRefundDialog` to a standalone action
    - Opened by a standalone "Mark as refunded" button rather than only from the retired early-checkout `RECORD_REFUND` branch; amount prefilled with the live excess and capped at it, remark required
    - Success handler surfaces a link to the generated Refund_Invoice from `refundInvoicePaymentId`, and updates its copy so nothing references Early Checkout
    - _Requirements: 14.1, 14.2, 14.3, 14.7_

  - [x] 23.4 Refactor `StayCheckoutActionBar`
    - The disabled hint names the *recalculated* end date (it already reads `stay.endDate`, which recalculation moves) and its wording changes from "use Early Checkout to close sooner" to "use Recalculate Stay to shorten the stay, then check out on the new end date"; the confirmation copy follows
    - The "Invoice generation failed — retry" button and the Backdated_Stay action pass `manualRetrigger: true`, surfacing the "A final invoice already exists" rejection when one does
    - _Requirements: 7.2, 8.9, 8.10, 12.13_

  - [x] 23.5 Rewire `AccommodationTab`
    - The "Early Checkout" header button becomes "Recalculate Stay", gated on `visibility.showRecalculateStay` (the removed `showEarlyCheckout` no longer exists); it stays available after a first recalculation
    - Render the standalone "Mark as refunded" button from `visibility.showMarkAsRefunded` rather than from a returned outcome branch, and render `StayRecalculationHistoryCard` beside the Extension History card
    - `handleEarlyCheckoutOutcome` becomes `handleStayDetailsSaved`: refetch the ledger and stay list so nights, end date, total, and both history lists update without a page reload, and **never** trigger a checkout refresh path. Drop the `EarlyCheckoutDialog` import
    - _Requirements: 12.1, 12.9, 12.10, 12.12, 13.3, 14.1_

  - [ ]* 23.6 Write unit tests for the Recalculate Stay dialog
    - `src/shared/components/admin/customers/__tests__/RecalculateStayDialog.test.tsx`: the picker and amount are prefilled with the stay's current Computed_End_Date and Total_Stay_Amount; the primary button reads "Save Stay Details" and no checkout affordance renders; the derived "Total nights" line updates as the date changes with no night-count input present; the start date is selectable and yields 1 night; a 1-night stay still renders an enabled picker
    - _Requirements: 12.2, 12.3, 12.7_

  - [ ]* 23.7 Write unit tests for the two history cards
    - `src/shared/components/admin/customers/__tests__/StayRecalculationHistoryCard.test.tsx`: both cards render, each fed from its own array with neither reading the other's; the recalculation card shows its empty-state copy for a stay with no entries; ordering is oldest-first
    - _Requirements: 13.3, 13.4, 13.6, 13.7_

  - [ ]* 23.8 Write the end-to-end integration test for the recalculation flow
    - An ACTIVE overpaid stay is recalculated to an earlier end date → stay is still ACTIVE with no Final_Consolidated_Invoice → Mark as refunded records the REFUND and its Refund_Invoice → balance is exactly zero → Mark as Checked Out becomes enabled only once the IST date reaches the recalculated end date → FINISHED with exactly one Final_Consolidated_Invoice showing the recalculated nights and total, alongside the earlier Refund_Invoice
    - _Requirements: 12.9, 12.13, 13.1, 14.7, 14.10_

- [x] 24. Final checkpoint - full suite after Revision 2
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Revision 1 (tasks 1–12) covered the design's original 23 correctness properties with exactly one property test each, placed next to the code they constrain; each property test lives in its own file so the suite parallelises cleanly
- Property tests run at least 100 iterations (`fc.assert(..., { numRuns: 100 })`) and carry the tag `Feature: accommodation-payment-lifecycle, Property {number}: {title}`
- `Total_Paid` and `Remaining_Balance` are never persisted — every read derives them from the ledger, and every balance-mutating write goes through a row-locking RPC, so no code path can leave a stored balance stale
- Money comparisons happen in integer paise inside the service layer; "balance is exactly zero" is only ever evaluated there
- This spec is additive over `accommodation-customer-flow`. It extends `stay_entries`, `AccommodationService`, `stayRepository`, `stayActions`, `AccommodationTab`, and `QuickOnboardingForm` in place; tasks 12 and 13 of that spec's plan (admin Accommodation tab surfaces) remain its own scope and are only touched here through the payment panel wiring in task 11.6
- Per design decision 7, accommodation stays no longer write a `payments` row at onboarding or extension; revenue is recognised once, at checkout. Existing `ACCOMMODATION_STAY` / `ACCOMMODATION_EXTENSION` rows are left untouched for historical accuracy
- The migration is idempotent and carries a Rollback block, so re-running is always safe

### Revision 2 notes (tasks 13–24)

- Tasks 1–12 are shipped and in production. Revision 2 is a **refactor-heavy delta** over that code: where a task replaces a shipped symbol it says so explicitly, and the old symbol is **removed** rather than left in place, so there is never a second live path. The retirements are `saveStayDetailsAction` ← `earlyCheckoutStayAction`, `applyStayRecalculationMath` ← `applyEarlyCheckoutMath`, `isRecalculationEligible` ← `isEarlyCheckoutEligible`, `AccommodationService.saveStayDetails` ← `earlyCheckout`, `stayRepository.saveStayDetails` ← `applyEarlyCheckout`, `createRecalculateStaySchema` ← `createEarlyCheckoutSchema`, `RecalculateStayDialog` ← `EarlyCheckoutDialog`, `SaveStayDetailsOutcome` ← `EarlyCheckoutOutcome`, and `showRecalculateStay` ← `showEarlyCheckout`. Task 20.7 asserts none of the retired names survives
- The design defines **30 correctness properties**. Properties 1–6, 8, 9, 11, 14, 16, 17, and 18 are unchanged — their shipped tests stay exactly as they are and no task touches them. Properties **7, 10, 12, 13, 15, 19, 20, 21, 22, 23** are revised, each with a task updating its existing test file (Property 20's and Property 21's files are renamed with their subjects). Properties **24–30** are new, each with a task creating its test. Still one property, one test, one file
- `scripts/create-stay-recalculation.sql` is a **new** additive idempotent script, not an edit to `create-stay-payment-lifecycle.sql`. Nothing is dropped: `early_checkout_applied`, `actual_nights_stayed`, and `original_total_*` are retained with narrowed roles, and the `payments.invoice_type` CHECK is widened so every pre-existing value stays admissible
- The Recalculate Stay calendar bound is the **inclusive** range `[stay start date, currently booked Computed_End_Date]`. The start date itself is selectable and derives exactly 1 night, so the range is never empty and needs no availability flag — for a 1-night stay it collapses to that single date. No task may reintroduce a `start + 1 day` minimum, a 2-night minimum, or the retired `[1, bookedTotalNights − 1]` night-count bound
- Save Stay Details is a pure data write: it never transitions `Stay_Status`, never stamps `checked_out_at`, and never generates a Final_Consolidated_Invoice. `Mark as Checked Out` remains the sole path to FINISHED and needs no code change — the recalculated end date flows into the existing Requirement 7 gate through `total_nights`
- The two invoice types fail in deliberately opposite directions: a Final_Consolidated_Invoice failure **preserves** the FINISHED transition and exposes a retry, while a Refund_Invoice failure **rolls the REFUND ledger row back** inside the same RPC transaction. No Node-side compensating delete is used, since that delete can itself fail

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
    { "id": 13, "tasks": ["11.8", "11.9"] },
    { "id": 14, "tasks": ["13.1", "14.1"] },
    { "id": 15, "tasks": ["13.2", "14.2", "14.3"] },
    { "id": 16, "tasks": ["14.4", "15.1"] },
    { "id": 17, "tasks": ["15.2", "15.3", "15.8"] },
    { "id": 18, "tasks": ["15.4", "15.5", "15.9"] },
    { "id": 19, "tasks": ["15.6", "15.7", "17.1", "17.2", "17.3"] },
    { "id": 20, "tasks": ["17.4", "18.1"] },
    { "id": 21, "tasks": ["18.2", "18.3", "18.4", "18.5"] },
    { "id": 22, "tasks": ["18.6", "18.7", "18.8", "18.9", "18.10", "20.1", "20.2", "20.4", "21.1"] },
    { "id": 23, "tasks": ["20.3", "20.5", "20.6", "20.7", "21.3", "23.1", "23.2", "23.3", "23.4"] },
    { "id": 24, "tasks": ["21.2", "21.4", "23.5"] },
    { "id": 25, "tasks": ["23.6", "23.7", "23.8"] }
  ]
}
```
