# Requirements Document

## Introduction

This feature extends the existing ACCOMMODATION customer category (defined in the `accommodation-customer-flow` specification) with three related capabilities:

1. **Backdated onboarding** — allowing admins to select a past date as the stay start date during accommodation onboarding, mirroring the past-date selection pattern already implemented for meal onboarding in the `onboarding-past-date-flexibility` specification, adapted to the simpler accommodation date model (no per-day delivery status capture).
2. **Partial/installment payment tracking** — replacing the single upfront-payment assumption with an advance amount collected at onboarding plus any number of partial/balance payments recorded during the stay, a running balance derived from a full payment transaction history, and per-transaction payment receipts labeled "Advance" or "Partial / Balance Payment."
3. **Checkout gating and final invoicing** — an explicit "Mark as Checked Out" action on the `Accommodation_Tab` that is blocked until the full balance is paid, and generation of exactly one `Final_Consolidated_Invoice` per `Stay_Entry` (in the same style as existing Meal/KIT invoices) that shows the final total and nights stayed without itemizing individual partial payments.

This feature also refines the existing `Stay_Extension` ("Extend Stay") action so that additional nights and additional cost integrate into the same running-balance system rather than creating a separate payment record, and refines initial `Stay_Status` assignment to cover backdated stays whose computed end date has already passed at creation time.

A fourth capability, **early checkout with amount recalculation**, allows an admin to check out a guest before their currently booked total nights have elapsed (e.g., an emergency departure). The admin records the actual nights stayed and a recalculated stay amount for those nights, and the system either collects any remaining balance owed or records a refund transaction when the guest has already paid more than the recalculated amount, before finalizing the stay.

This is an additive extension on top of the `accommodation-customer-flow` specification. It reuses that specification's entities and terminology (`Stay_Entry`, `Stay_Status`, `GST_Breakup`, `Customer_360_Dashboard`, `Accommodation_Tab`, `Quick_Onboard_Form`) and its established patterns (Server Actions, Zod schemas, EARS-format acceptance criteria) rather than redefining them.

**Out of scope:** Any changes to Meal or KIT onboarding, payment, or invoicing flows; any changes to the core `Stay_Status` transition cron logic beyond initial-status assignment for backdated stays and checkout-triggered transitions; any new payment gateway or Razorpay integration (all amounts remain admin-entered, consistent with the existing manual payment amount entry pattern).

## Glossary

Terms reused unchanged from `accommodation-customer-flow`:

- **Stay_Entry**: A single accommodation booking record representing one continuous stay period with its own billing
- **Stay_Status**: The lifecycle state of a Stay_Entry — one of PENDING, ACTIVE, FINISHED, or EXPIRED
- **GST_Breakup**: The tax calculation where baseAmount = totalAmount / 1.18 and taxAmount = totalAmount - baseAmount at 18% GST
- **Customer_360_Dashboard**: The admin-facing comprehensive view of a single customer's data organized in tabs
- **Accommodation_Tab**: The dedicated tab in Customer_360_Dashboard showing stay details, health logs, and stay management for accommodation customers
- **Quick_Onboard_Form**: The admin-facing multi-step wizard used to create new customer profiles

Terms clarified or newly introduced by this feature:

- **Computed_End_Date**: The last day of a Stay_Entry, calculated as start date + total nights − 1 (dates inclusive), as defined in `accommodation-customer-flow`
- **Stay_Extension**: The existing "Extend Stay" admin action that adds additional nights and an additional cost amount to an ACTIVE Stay_Entry, refined by this feature to integrate with Total_Stay_Amount and Remaining_Balance
- **Backdated_Stay_Toggle**: A checkbox on the accommodation fields step of the Quick_Onboard_Form that, when checked, allows selection of a Past_Stay_Start date
- **Past_Stay_Start**: A Stay_Entry start date earlier than the current IST date, selectable only while the Backdated_Stay_Toggle is checked, within 30 calendar days before the current IST date
- **Backdated_Stay**: A Stay_Entry created with a Past_Stay_Start date whose Computed_End_Date is already before the current IST date at creation time, resulting in Stay_Status FINISHED immediately upon creation
- **Payment_Transaction**: An individual record of money received from or refunded to a guest against a Stay_Entry, storing amount, date, comment, remark, and a Payment_Transaction_Type
- **Payment_Transaction_Type**: The classification of a Payment_Transaction — one of "ADVANCE", "PARTIAL_BALANCE_PAYMENT", or "REFUND"
- **Advance_Amount**: The amount collected at onboarding time, recorded as the Stay_Entry's first Payment_Transaction of type ADVANCE (when greater than zero)
- **Total_Stay_Amount**: The total amount owed for a Stay_Entry, equal to the onboarding total stay amount plus the sum of all Stay_Extension cost amounts applied to it, further replaced by Recalculated_Stay_Amount if an Early_Checkout has been applied
- **Total_Paid**: The sum of the amount fields of all Payment_Transaction records of type ADVANCE or PARTIAL_BALANCE_PAYMENT associated with a Stay_Entry, minus the sum of the amount fields of all Payment_Transaction records of type REFUND associated with that Stay_Entry
- **Remaining_Balance**: Total_Stay_Amount minus Total_Paid for a Stay_Entry (may be negative before a required refund is recorded)
- **Early_Checkout**: The admin action that checks out an ACTIVE Stay_Entry before all of its currently booked total nights have elapsed, capturing Actual_Nights_Stayed and a Recalculated_Stay_Amount
- **Actual_Nights_Stayed**: The number of nights the guest actually stayed, entered by the admin during Early_Checkout, strictly less than the Stay_Entry's total nights at the time of the Early_Checkout
- **Recalculated_Stay_Amount**: The admin-determined amount owed for Actual_Nights_Stayed, entered during Early_Checkout, which replaces the Stay_Entry's Total_Stay_Amount
- **Refund_Amount**: The amount returned to a guest, recorded as a Payment_Transaction of type REFUND, required when Total_Paid exceeds the Recalculated_Stay_Amount following an Early_Checkout
- **Mark_As_Checked_Out**: The admin action on the Accommodation_Tab that transitions an ACTIVE Stay_Entry to Stay_Status FINISHED and triggers Final_Consolidated_Invoice generation, gated on Remaining_Balance equal to zero
- **Final_Consolidated_Invoice**: The single invoice generated when a Stay_Entry is checked out, showing Total_Stay_Amount (Total_Paid) and total nights stayed, without itemizing individual Payment_Transaction records
- **Payment_Receipt**: A per-transaction record/receipt for an individual Payment_Transaction, labeled with its Payment_Transaction_Type

## Requirements

### Requirement 1: Backdated Stay Start Date Selection

**User Story:** As an admin, I want to select a past date as the stay start date during accommodation onboarding, so that I can create system entries for guests who have already been staying.

#### Acceptance Criteria

1. WHEN the admin is on the accommodation fields step of the Quick_Onboard_Form with "ACCOMMODATION" selected as primary category, THE Quick_Onboard_Form SHALL display a Backdated_Stay_Toggle checkbox positioned below the stay start date field.
2. WHILE the Backdated_Stay_Toggle is unchecked, THE Quick_Onboard_Form SHALL restrict the stay start date field to today through 365 days in the future, consistent with the existing accommodation onboarding start date behavior.
3. WHEN the admin checks the Backdated_Stay_Toggle, THE Quick_Onboard_Form SHALL enable selection of stay start dates from 30 days before the current IST date up to and including yesterday (current IST date minus 1 day), and disable selection of today and future dates, in the stay start date field.
4. IF the admin unchecks the Backdated_Stay_Toggle after selecting a Past_Stay_Start date, THEN THE Quick_Onboard_Form SHALL immediately clear the selected start date and revert the stay start date field to the today-through-365-days-future range.
5. THE Quick_Onboard_Form SHALL apply the Backdated_Stay_Toggle and Past_Stay_Start fields only when "ACCOMMODATION" is the selected primary category, leaving Meal and KIT onboarding start date behavior unchanged.

### Requirement 2: Backdated Stay Completion Alert and Total Nights Adjustment

**User Story:** As an admin, I want to be warned when a backdated stay's computed end date is already in the past, so that I can decide whether to adjust total nights or proceed knowing the stay will be marked finished immediately.

#### Acceptance Criteria

1. WHEN the admin has selected a Past_Stay_Start date and entered a total nights value such that the Computed_End_Date is before the current IST date, THE Quick_Onboard_Form SHALL display an alert message indicating the computed end date has already passed and that the Stay_Entry will be created with Stay_Status FINISHED immediately upon submission.
2. WHILE the alert described in Acceptance Criterion 1 is displayed, THE Quick_Onboard_Form SHALL allow the admin to increase the total nights stay value without leaving the current step.
3. WHEN the admin changes the total nights stay value such that the Computed_End_Date becomes on or after the current IST date, THE Quick_Onboard_Form SHALL immediately hide the alert message and indicate that the Stay_Entry will be created with Stay_Status ACTIVE, without requiring the admin to move focus away from the total nights field or advance to another step.
4. THE Quick_Onboard_Form SHALL allow the admin to submit the onboarding form while the alert described in Acceptance Criterion 1 is displayed, without requiring the admin to change the total nights value.
5. WHILE the Computed_End_Date for a Past_Stay_Start selection is on or after the current IST date, THE Quick_Onboard_Form SHALL NOT display the alert message described in Acceptance Criterion 1.

### Requirement 3: Initial Stay Status Assignment for Backdated Stays

**User Story:** As a system operator, I want backdated Stay_Entry records to receive the correct initial Stay_Status, so that stay lifecycle state accurately reflects guests who have already completed or are still within their stay.

#### Acceptance Criteria

1. WHEN the system creates a Stay_Entry with a Past_Stay_Start date whose Computed_End_Date is before the current IST date, THE System SHALL assign Stay_Status FINISHED immediately upon creation, bypassing PENDING and ACTIVE, and SHALL classify the record as a Backdated_Stay.
2. WHEN the system creates a Stay_Entry with a Past_Stay_Start date whose Computed_End_Date is on or after the current IST date, THE System SHALL assign Stay_Status ACTIVE immediately upon creation.
3. THE System SHALL apply the existing Stay_Status transition rules (PENDING to ACTIVE, PENDING to EXPIRED, ACTIVE to FINISHED) unchanged for Stay_Entry records whose start date is today or in the future.
4. WHEN the payload submitted to the accommodation onboarding server action contains a stay start date earlier than the current IST date AND the Backdated_Stay_Toggle flag is false, THE System SHALL reject the request with an error message indicating that backdated stay entry must be enabled.
5. WHEN the payload submitted to the accommodation onboarding server action contains a stay start date earlier than 30 calendar days before the current IST date, THE System SHALL reject the request with an error message indicating the date exceeds the maximum backdated range.

### Requirement 4: Accommodation Onboarding Payment Split (Total Amount vs Advance)

**User Story:** As an admin, I want to record a total stay amount and an advance amount at onboarding, so that partial payment tracking can begin from the moment a guest is onboarded.

#### Acceptance Criteria

1. WHEN the admin selects "ACCOMMODATION" as the primary category in the Quick_Onboard_Form AND the shared payment checkbox is unchecked, THE Quick_Onboard_Form SHALL display two payment fields in place of the single payment amount field: total stay amount and advance amount paid.
2. THE Quick_Onboard_Form SHALL render total stay amount as a numeric input accepting values from 1 to 9,999,999, representing the Total_Stay_Amount inclusive of 18% GST, and THE System SHALL enforce this range at the server action level regardless of whether the field is currently visible in the form.
3. THE Quick_Onboard_Form SHALL render advance amount paid as a numeric input accepting values from 0 up to the entered total stay amount, and THE System SHALL enforce this range at the server action level regardless of whether the field is currently visible in the form.
4. IF the admin enters an advance amount paid greater than the entered total stay amount, THEN THE Quick_Onboard_Form SHALL reject the entry and display an error message indicating the advance amount cannot exceed the total stay amount.
5. WHEN the admin completes onboarding for an accommodation customer with an advance amount paid greater than zero, THE System SHALL set the Stay_Entry's Total_Stay_Amount to the entered total stay amount and SHALL record one Payment_Transaction of type ADVANCE with the entered advance amount and the current date.
6. WHEN the admin completes onboarding for an accommodation customer with an advance amount paid equal to zero, THE System SHALL set the Stay_Entry's Total_Stay_Amount to the entered total stay amount and SHALL create no Payment_Transaction records, resulting in a Remaining_Balance equal to the Total_Stay_Amount.
7. WHILE the shared payment checkbox is checked, THE Quick_Onboard_Form SHALL hide the total stay amount and advance amount paid fields, and THE System SHALL NOT create a Total_Stay_Amount or any Payment_Transaction for that Stay_Entry, consistent with existing Shared_Payment behavior. WHILE the shared payment checkbox is unchecked, THE System SHALL create a Total_Stay_Amount and Payment_Transaction records for that Stay_Entry as described in this requirement.
8. THE System SHALL calculate the GST_Breakup for a Stay_Entry using the Total_Stay_Amount as the totalAmount input, consistent with the existing GST_Breakup calculation.

### Requirement 5: Partial and Balance Payment Recording

**User Story:** As an admin, I want to record partial payments made during a guest's stay from the Customer_360_Dashboard, so that the running balance stays accurate.

#### Acceptance Criteria

1. THE Accommodation_Tab SHALL display a "Record Payment" form containing fields amount paid, comment, and remark, for any Stay_Entry with Stay_Status ACTIVE or FINISHED and a Remaining_Balance greater than zero.
2. THE Accommodation_Tab SHALL render amount paid as a numeric input accepting values greater than 0 and up to the current Remaining_Balance for the Stay_Entry.
3. THE Accommodation_Tab SHALL render comment as a required text input with a maximum length of 500 characters.
4. THE Accommodation_Tab SHALL render remark as an optional text input with a maximum length of 500 characters.
5. IF the admin submits an amount paid greater than the current Remaining_Balance, THEN THE Accommodation_Tab SHALL reject the submission and display an error message indicating the amount cannot exceed the remaining balance.
6. IF the admin submits an amount paid of zero or less, THEN THE Accommodation_Tab SHALL reject the submission, display an error message indicating the amount must be greater than zero, and THE System SHALL NOT record a Payment_Transaction.
7. IF the admin submits the "Record Payment" form without a comment, THEN THE Accommodation_Tab SHALL reject the submission and display an error message indicating a comment is required.
8. WHEN the admin submits a valid "Record Payment" form with an amount paid greater than zero, THE System SHALL record one Payment_Transaction of type PARTIAL_BALANCE_PAYMENT for the Stay_Entry with the entered amount, comment, remark, and the current date.
9. WHEN a "Record Payment" form submission completes, THE Accommodation_Tab SHALL recalculate and display the updated Total_Paid and Remaining_Balance for the Stay_Entry immediately, without requiring a page reload, whether or not the Payment_Transaction was successfully recorded.
10. WHILE the Remaining_Balance for a Stay_Entry is zero, THE Accommodation_Tab SHALL hide the "Record Payment" form and display a message indicating the stay is fully paid.

### Requirement 6: Payment Transaction History and Balance Consistency

**User Story:** As an admin, I want a complete payment history per stay with a consistent running balance, so that I can audit and trust the financial state of any guest's stay.

#### Acceptance Criteria

1. THE System SHALL maintain one Payment_Transaction record for every payment received from or refunded to a guest against a Stay_Entry, including the onboarding Advance_Amount (when greater than zero), every subsequent partial or balance payment, and any Refund_Amount recorded during an Early_Checkout.
2. EACH Payment_Transaction record SHALL store amount, date, comment, remark, and a Payment_Transaction_Type of "ADVANCE", "PARTIAL_BALANCE_PAYMENT", or "REFUND".
3. THE System SHALL calculate Total_Paid for a Stay_Entry as the sum of the amount fields of all Payment_Transaction records of type ADVANCE or PARTIAL_BALANCE_PAYMENT associated with that Stay_Entry, minus the sum of the amount fields of all Payment_Transaction records of type REFUND associated with that Stay_Entry.
4. THE System SHALL calculate Remaining_Balance for a Stay_Entry as Total_Stay_Amount minus Total_Paid.
5. THE Accommodation_Tab SHALL display the payment history for a Stay_Entry as a chronologically ordered list showing, for each Payment_Transaction, its date, amount, Payment_Transaction_Type label, comment, and remark.
6. THE Accommodation_Tab SHALL display Total_Stay_Amount, Total_Paid, and Remaining_Balance for the currently selected Stay_Entry, updated immediately after any Payment_Transaction is recorded or any Stay_Extension is applied.
7. WHILE no Payment_Transaction records exist for a Stay_Entry with a Total_Stay_Amount greater than zero, THE Accommodation_Tab SHALL display Remaining_Balance equal to the Total_Stay_Amount and Total_Paid equal to zero.

### Requirement 7: Checkout Gating — Mark As Checked Out

**User Story:** As an admin, I want to be blocked from checking out a guest until their full balance is paid, so that no guest departs with an outstanding balance unrecorded.

#### Acceptance Criteria

1. THE Accommodation_Tab SHALL display a "Mark as Checked Out" action for any Stay_Entry with Stay_Status ACTIVE.
2. THE Accommodation_Tab SHALL disable the "Mark as Checked Out" action by default, and SHALL enable it only when the Remaining_Balance for the Stay_Entry is exactly zero; WHILE the Remaining_Balance is greater than zero, THE Accommodation_Tab SHALL keep the action disabled and display a message indicating the outstanding Remaining_Balance amount.
3. WHEN the admin invokes "Mark as Checked Out" for a Stay_Entry with Remaining_Balance equal to zero, THE System SHALL transition the Stay_Entry's Stay_Status from ACTIVE to FINISHED.
4. IF the "Mark as Checked Out" action is invoked for a Stay_Entry with Remaining_Balance greater than zero, THEN THE System SHALL reject the request at the server action level and always return an error message indicating the balance must be fully paid before checkout, regardless of client-side button state.
5. THE System SHALL reject invocation of the "Mark as Checked Out" action for a Stay_Entry whose Stay_Status is not ACTIVE, returning an error message indicating checkout applies only to active stays.

### Requirement 8: Final Consolidated Invoice Generation at Checkout

**User Story:** As an admin, I want a single consolidated invoice generated when a guest checks out, so that the guest receives one clean invoice without a breakdown of every partial payment.

#### Acceptance Criteria

1. WHEN a Stay_Entry with Total_Stay_Amount greater than zero transitions to Stay_Status FINISHED via the "Mark as Checked Out" action, THE System SHALL generate exactly one Final_Consolidated_Invoice for that Stay_Entry.
2. IF a Stay_Entry has Total_Stay_Amount equal to zero, THEN THE System SHALL transition it to Stay_Status FINISHED via "Mark as Checked Out" without generating a Final_Consolidated_Invoice.
3. THE Final_Consolidated_Invoice SHALL display the Total_Stay_Amount, the GST_Breakup of the Total_Stay_Amount, and the total nights stayed; WHEN the Stay_Entry was closed via Early_Checkout, THE Final_Consolidated_Invoice SHALL display the Recalculated_Stay_Amount in place of the original Total_Stay_Amount and Actual_Nights_Stayed in place of the originally booked total nights.
4. THE Final_Consolidated_Invoice SHALL use the same layout and formatting conventions as existing Meal and KIT customer invoices.
5. THE Final_Consolidated_Invoice SHALL NOT display individual Payment_Transaction amounts, dates, comments, or remarks.
6. THE System SHALL generate at most one Final_Consolidated_Invoice per Stay_Entry.
7. IF Final_Consolidated_Invoice generation fails due to a system error after the Stay_Entry has transitioned to Stay_Status FINISHED, THEN THE System SHALL preserve the Stay_Status FINISHED transition, SHALL log the invoice generation failure, and SHALL allow the admin to manually trigger invoice generation for that Stay_Entry at a later time.

### Requirement 9: Backdated Stay Final Invoice Handling

**User Story:** As an admin, I want to still be able to collect outstanding balance and generate a final invoice for a stay that was already marked finished at creation time, so that late-entered guests are billed correctly.

#### Acceptance Criteria

1. IF a Stay_Entry is a Backdated_Stay, THEN THE Accommodation_Tab SHALL display the "Record Payment" form described in Requirement 5 for that Stay_Entry until its Remaining_Balance reaches zero.
2. IF a Stay_Entry is a Backdated_Stay AND its Remaining_Balance is zero AND no Final_Consolidated_Invoice has been generated for it, THEN THE Accommodation_Tab SHALL display a "Generate Final Invoice" action and SHALL hide the "Mark as Checked Out" action for that Stay_Entry. THE System SHALL NOT offer "Generate Final Invoice" for a Stay_Entry that is not a Backdated_Stay; non-backdated stays reach FINISHED status only through the "Mark as Checked Out" action described in Requirement 7.
3. WHEN the admin invokes "Generate Final Invoice" for an eligible Backdated_Stay, THE System SHALL generate exactly one Final_Consolidated_Invoice for that Stay_Entry, following the same content and format rules as Requirement 8.
4. THE Accommodation_Tab SHALL NOT display the "Mark as Checked Out" action for any Stay_Entry with Stay_Status FINISHED, and SHALL NOT display both the "Mark as Checked Out" action and the "Generate Final Invoice" action simultaneously for the same Stay_Entry.

### Requirement 10: Per-Transaction Payment Receipts and Audit Trail

**User Story:** As an admin, I want each individual payment to have its own labeled receipt, so that the audit trail is preserved even though the final invoice is consolidated.

#### Acceptance Criteria

1. THE System SHALL generate one Payment_Receipt for each Payment_Transaction recorded against a Stay_Entry.
2. EACH Payment_Receipt SHALL display the associated Payment_Transaction's amount, date, comment, remark, and a label of "Advance", "Partial / Balance Payment", or "Refund" corresponding to its Payment_Transaction_Type.
3. THE Accommodation_Tab SHALL provide access to view the Payment_Receipt for any individual Payment_Transaction from the payment history list.
4. THE System SHALL retain all Payment_Receipt and Payment_Transaction records for a Stay_Entry after its Final_Consolidated_Invoice has been generated.
5. WHEN a Final_Consolidated_Invoice is generated for a Stay_Entry, THE System SHALL NOT delete, modify, or hide any existing Payment_Receipt or Payment_Transaction record for that Stay_Entry.

### Requirement 11: Stay Extension Integration with Running Balance

**User Story:** As an admin, I want stay extensions to add to the same running balance system, so that extension charges are tracked consistently with the rest of the stay's payments.

#### Acceptance Criteria

1. WHEN the admin applies a Stay_Extension to an ACTIVE Stay_Entry with additional nights and an additional cost amount, THE System SHALL increase the Stay_Entry's total nights by the additional nights and increase Total_Stay_Amount by the additional cost amount.
2. WHEN a Stay_Extension is applied, THE System SHALL recalculate Remaining_Balance as the updated Total_Stay_Amount minus Total_Paid, and SHALL NOT create a Payment_Transaction record for the extension cost amount.
3. WHEN a Stay_Extension is applied, THE System SHALL recalculate the GST_Breakup using the updated Total_Stay_Amount.
4. THE Accommodation_Tab SHALL display the updated total nights, Total_Stay_Amount, Total_Paid, and Remaining_Balance immediately after a Stay_Extension is applied, without requiring a page reload.
5. IF the admin attempts to apply a Stay_Extension to a Stay_Entry that is not in ACTIVE status, THEN THE System SHALL reject the operation and display an error message indicating that only active stays can be extended, consistent with existing Stay_Extension behavior.
6. THE System SHALL allow subsequent Payment_Transaction records to be recorded against the increased Remaining_Balance following a Stay_Extension, using the same "Record Payment" process described in Requirement 5.

### Requirement 12: Early Checkout with Stay Amount Recalculation

**User Story:** As an admin, I want to check out a guest before their booked stay ends and recalculate the amount owed for the nights actually stayed, so that I can handle emergency early departures with an accurate final balance, whether that means collecting a remaining amount or issuing a refund.

#### Acceptance Criteria

1. THE Accommodation_Tab SHALL display an "Early Checkout" action for any Stay_Entry with Stay_Status ACTIVE whose Actual_Nights_Stayed as of the current IST date is less than its currently booked total nights.
2. WHEN the admin invokes "Early Checkout", THE Accommodation_Tab SHALL display a form containing Actual_Nights_Stayed and Recalculated_Stay_Amount input fields.
3. THE Accommodation_Tab SHALL render Actual_Nights_Stayed as a numeric input accepting integer values from 1 up to one less than the Stay_Entry's currently booked total nights.
4. THE Accommodation_Tab SHALL render Recalculated_Stay_Amount as a numeric input accepting values from 1 to 9,999,999.
5. IF the admin submits the "Early Checkout" form with an Actual_Nights_Stayed value that is not an integer from 1 up to one less than the currently booked total nights, THEN THE Accommodation_Tab SHALL reject the submission and display an error message indicating the value must be less than the currently booked total nights.
6. WHEN the admin submits a valid "Early Checkout" form, THE System SHALL set the Stay_Entry's total nights to Actual_Nights_Stayed and SHALL replace Total_Stay_Amount with the entered Recalculated_Stay_Amount.
7. WHEN the admin submits a valid "Early Checkout" form AND the resulting Remaining_Balance (Recalculated_Stay_Amount minus Total_Paid) is greater than zero, THE Accommodation_Tab SHALL display the "Record Payment" form described in Requirement 5 so the admin can collect the remaining amount, and SHALL NOT transition the Stay_Entry to Stay_Status FINISHED until that Remaining_Balance reaches zero.
8. WHEN the admin submits a valid "Early Checkout" form AND Total_Paid exceeds the Recalculated_Stay_Amount, THE Accommodation_Tab SHALL display a "Record Refund" form containing a refund amount field pre-filled with the excess amount (Total_Paid minus Recalculated_Stay_Amount) and a required remark field describing how the refund was initiated.
9. THE Accommodation_Tab SHALL render the "Record Refund" refund amount field as a numeric input accepting values from 1 up to the current excess amount (Total_Paid minus Recalculated_Stay_Amount).
10. IF the admin submits the "Record Refund" form without a remark, THEN THE Accommodation_Tab SHALL reject the submission and display an error message indicating a remark describing the refund initiation is required.
11. WHEN the admin submits a valid "Record Refund" form, THE System SHALL record one Payment_Transaction of type REFUND for the Stay_Entry with the entered refund amount, the required remark, an optional comment, and the current date.
12. WHEN the admin submits a valid "Early Checkout" form AND Total_Paid equals the Recalculated_Stay_Amount, THE System SHALL transition the Stay_Entry's Stay_Status from ACTIVE to FINISHED immediately, following the same Final_Consolidated_Invoice generation behavior as Requirement 8.
13. WHEN a Remaining_Balance of zero is reached following an Early_Checkout (through "Record Payment" or "Record Refund" as applicable), THE System SHALL transition the Stay_Entry's Stay_Status from ACTIVE to FINISHED and generate a Final_Consolidated_Invoice reflecting the Recalculated_Stay_Amount and Actual_Nights_Stayed, following the same generation rules as Requirement 8.
14. IF the admin attempts to apply a Stay_Extension or a subsequent Early_Checkout to a Stay_Entry that has already transitioned to Stay_Status FINISHED via Early_Checkout, THEN THE System SHALL reject the operation, consistent with existing status-based rejection behavior for non-ACTIVE stays.
15. THE System SHALL retain the Stay_Entry's original booked total nights and original Total_Stay_Amount value (prior to Early_Checkout recalculation) in the payment/stay history so that the audit trail reflects both the originally booked figures and the recalculated figures.
