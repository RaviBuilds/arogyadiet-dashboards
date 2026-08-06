# Requirements Document

## Introduction

This feature extends the existing ACCOMMODATION customer category (defined in the `accommodation-customer-flow` specification) with three related capabilities:

1. **Backdated onboarding** — allowing admins to select a past date as the stay start date during accommodation onboarding, mirroring the past-date selection pattern already implemented for meal onboarding in the `onboarding-past-date-flexibility` specification, adapted to the simpler accommodation date model (no per-day delivery status capture).
2. **Partial/installment payment tracking** — replacing the single upfront-payment assumption with an advance amount collected at onboarding plus any number of partial/balance payments recorded during the stay, a running balance derived from a full payment transaction history, and per-transaction payment receipts labeled "Advance" or "Partial / Balance Payment."
3. **Checkout gating and final invoicing** — an explicit "Mark as Checked Out" action on the `Accommodation_Tab` that is blocked until the full balance is paid, and generation of exactly one `Final_Consolidated_Invoice` per `Stay_Entry` (in the same style as existing Meal/KIT invoices) that shows the final total and nights stayed without itemizing individual partial payments.

This feature also refines the existing `Stay_Extension` ("Extend Stay") action so that additional nights and additional cost integrate into the same running-balance system rather than creating a separate payment record, and refines initial `Stay_Status` assignment to cover backdated stays whose computed end date has already passed at creation time.

A fourth capability, **stay recalculation (including early checkout)**, allows an admin to adjust a guest's stay end date and/or total stay amount at any point during an active stay — for example, an emergency early departure, or simply correcting the billed amount without changing the stay length. Recalculating and saving new stay details is a distinct action from finalizing checkout: saving updates the nights and amount (and, when money is owed back, lets the admin record a refund) without by itself transitioning the stay's status. The existing "Mark as Checked Out" action becomes available once the recalculated end date is today and the balance is exactly zero, so finalizing the checkout remains an explicit, separate step the admin takes deliberately.

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
- **Total_Stay_Amount**: The total amount owed for a Stay_Entry, equal to the onboarding total stay amount plus the sum of all Stay_Extension cost amounts applied to it, further replaced by the Recalculated_Stay_Amount each time Save_Stay_Details is invoked
- **Total_Paid**: The sum of the amount fields of all Payment_Transaction records of type ADVANCE or PARTIAL_BALANCE_PAYMENT associated with a Stay_Entry, minus the sum of the amount fields of all Payment_Transaction records of type REFUND associated with that Stay_Entry
- **Remaining_Balance**: Total_Stay_Amount minus Total_Paid for a Stay_Entry (may be negative before a required refund is recorded)
- **Recalculate_Stay**: The admin action, invoked from the Accommodation_Tab, that opens a form to change an ACTIVE Stay_Entry's end date and/or Total_Stay_Amount without, by itself, changing the Stay_Entry's Stay_Status. Replaces the previous "Early Checkout" action; Early_Checkout is now the specific case of a Recalculate_Stay submission that shortens the stay
- **Recalculated_End_Date**: The new Computed_End_Date for a Stay_Entry, selected by the admin through a calendar date picker during Recalculate_Stay, constrained to fall on or after the Stay_Entry's start date and on or before its currently booked Computed_End_Date (never later — lengthening a stay remains the Stay_Extension action's role)
- **Early_Checkout**: The specific outcome of a Recalculate_Stay submission whose Recalculated_End_Date is earlier than the Stay_Entry's currently booked Computed_End_Date, i.e., the guest is departing before the originally booked stay length
- **Recalculated_Total_Nights**: The Stay_Entry's total nights recomputed from its start date and Recalculated_End_Date (inclusive), replacing the Stay_Entry's total nights when Save_Stay_Details is invoked
- **Recalculated_Stay_Amount**: The admin-entered "Recalculated total stay amount" during Recalculate_Stay, which replaces the Stay_Entry's Total_Stay_Amount when Save_Stay_Details is invoked
- **Save_Stay_Details**: The button within the Recalculate_Stay form that persists the Recalculated_End_Date (and the Total_Stay_Amount on the main Accommodation_Tab interface) recalculated from it, and the Recalculated_Stay_Amount, to the Stay_Entry. Save_Stay_Details SHALL NOT transition the Stay_Entry's Stay_Status and SHALL NOT trigger Final_Consolidated_Invoice generation — finalizing checkout remains the separate Mark_As_Checked_Out action
- **Recalculation_History**: A chronological, purely informational record of every Save_Stay_Details submission applied to a Stay_Entry, distinct from Stay_Extension history, capturing the nights and Total_Stay_Amount immediately before and after each submission
- **Refund_Amount**: The amount returned to a guest, recorded as a Payment_Transaction of type REFUND, entered by the admin when Total_Paid exceeds the Stay_Entry's current Total_Stay_Amount following a Save_Stay_Details submission
- **Mark_As_Refunded**: The admin action, available from the Recalculate_Stay flow whenever Total_Paid exceeds the current Total_Stay_Amount, that records a Refund_Amount as a Payment_Transaction of type REFUND and generates a Refund_Invoice
- **Refund_Invoice**: A generated document distinct from the Final_Consolidated_Invoice, produced each time Mark_As_Refunded records a REFUND Payment_Transaction, showing the refunded amount, the remark describing how the refund was initiated, the date, and a reference to the Stay_Entry. Unlike the Final_Consolidated_Invoice, a Stay_Entry may have more than one Refund_Invoice (at most one per REFUND Payment_Transaction)
- **Mark_As_Checked_Out**: The admin action on the Accommodation_Tab that transitions an ACTIVE Stay_Entry to Stay_Status FINISHED and triggers Final_Consolidated_Invoice generation, gated on Remaining_Balance equal to zero and, for a Stay_Entry that has had Save_Stay_Details applied, on the current date being on or after the Recalculated_End_Date
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
10. WHILE the Remaining_Balance for a Stay_Entry is exactly zero, THE Accommodation_Tab SHALL hide the "Record Payment" form and display a message indicating the stay is fully paid; WHILE the Remaining_Balance for a Stay_Entry is greater than zero and the Stay_Entry is otherwise eligible under Acceptance Criterion 1, THE Accommodation_Tab SHALL display the "Record Payment" form.

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
2. WHEN a Stay_Entry with Total_Stay_Amount equal to zero transitions to Stay_Status FINISHED via the "Mark as Checked Out" action, THE System SHALL complete that transition without generating a Final_Consolidated_Invoice.
3. THE Final_Consolidated_Invoice SHALL display the Total_Stay_Amount, the GST_Breakup of the Total_Stay_Amount, and the total nights stayed.
4. WHEN the Stay_Entry has had Save_Stay_Details applied at least once, THE Final_Consolidated_Invoice SHALL display the current (recalculated) Total_Stay_Amount in place of the originally booked Total_Stay_Amount and SHALL display the current (recalculated) total nights stayed in place of the originally booked total nights.
5. THE Final_Consolidated_Invoice SHALL use the same layout and formatting conventions as existing Meal and KIT customer invoices.
6. THE Final_Consolidated_Invoice SHALL NOT display individual Payment_Transaction amounts, dates, comments, or remarks.
7. THE System SHALL generate at most one Final_Consolidated_Invoice per Stay_Entry.
8. IF Final_Consolidated_Invoice generation fails due to a system error after the Stay_Entry has transitioned to Stay_Status FINISHED, THEN THE System SHALL preserve the Stay_Status FINISHED transition and SHALL log the invoice generation failure.
9. WHEN an admin manually triggers invoice generation for a Stay_Entry whose Final_Consolidated_Invoice generation previously failed, THE System SHALL generate the Final_Consolidated_Invoice for that Stay_Entry.
10. IF a manual invoice generation trigger is invoked for a Stay_Entry that already has a Final_Consolidated_Invoice, THEN THE System SHALL reject the manual trigger and SHALL NOT generate a duplicate Final_Consolidated_Invoice for that Stay_Entry.

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
5. IF the admin attempts to apply a Stay_Extension to a Stay_Entry that is not in ACTIVE status, THEN THE System SHALL reject the entire operation, SHALL make no change to the Stay_Entry's total nights, Total_Stay_Amount, or GST_Breakup, and SHALL display an error message indicating that only active stays can be extended, consistent with existing Stay_Extension behavior.
6. THE System SHALL allow subsequent Payment_Transaction records to be recorded against the increased Remaining_Balance following a Stay_Extension, using the same "Record Payment" process described in Requirement 5.

### Requirement 12: Stay Recalculation (Recalculate Stay, Including Early Checkout)

**User Story:** As an admin, I want to recalculate a guest's stay end date and total stay amount independently of finalizing checkout, so that I can handle emergency early departures, amount-only corrections, or both, and only complete the checkout as an explicit separate step once the guest has actually left and the balance is settled.

#### Acceptance Criteria

1. THE Accommodation_Tab SHALL display a "Recalculate Stay" action for any Stay_Entry with Stay_Status ACTIVE, non-shared-payment, with a positive Total_Stay_Amount.
2. WHEN the admin invokes "Recalculate Stay", THE Accommodation_Tab SHALL display a form containing a calendar date picker for the Recalculated_End_Date and a "Recalculated total stay amount" numeric input, both pre-filled with the Stay_Entry's current Computed_End_Date and current Total_Stay_Amount.
3. THE Accommodation_Tab SHALL restrict the calendar date picker to dates on or after the Stay_Entry's start date and on or before its currently booked Computed_End_Date, with both bounds selectable, SHALL allow selection of the Stay_Entry's start date itself (yielding a Recalculated_Total_Nights of exactly 1, the minimum stay length), and SHALL NOT allow selection of any date before the Stay_Entry's start date or any date after the currently booked Computed_End_Date; lengthening a stay beyond its currently booked Computed_End_Date remains available only through the Stay_Extension action.
4. THE Accommodation_Tab SHALL render "Recalculated total stay amount" as a numeric input accepting only whole-number (integer) values from 1 to 9,999,999, and SHALL reject entry or submission of decimal, fractional, or non-integer values.
5. IF the admin submits the "Recalculate Stay" form with a Recalculated_End_Date outside the range described in Acceptance Criterion 3, or a "Recalculated total stay amount" outside the range or whole-number constraint described in Acceptance Criterion 4, THEN THE Accommodation_Tab SHALL reject the submission and display an error message identifying the field and its valid range, and THE System SHALL enforce both ranges at the server action level regardless of client-side field state.
6. THE Accommodation_Tab SHALL accept a "Recalculate Stay" submission whose Recalculated_End_Date equals the Stay_Entry's current Computed_End_Date, whose "Recalculated total stay amount" equals the Stay_Entry's current Total_Stay_Amount, or both — an admin MAY change only the date, only the amount, both, or submit with neither changed.
7. THE Accommodation_Tab SHALL display a "Save Stay Details" action within the "Recalculate Stay" form, distinct from the "Mark as Checked Out" action described in Requirement 7.
8. WHEN the admin invokes "Save Stay Details" with a valid submission, THE System SHALL recompute the Stay_Entry's total nights from its start date and the submitted Recalculated_End_Date, SHALL set the Stay_Entry's total nights to that Recalculated_Total_Nights, and SHALL replace the Stay_Entry's Total_Stay_Amount with the submitted "Recalculated total stay amount".
9. WHEN "Save Stay Details" is invoked, THE System SHALL NOT transition the Stay_Entry's Stay_Status and SHALL NOT generate a Final_Consolidated_Invoice, regardless of the resulting Remaining_Balance or Recalculated_End_Date; THE Accommodation_Tab SHALL immediately recalculate and display the updated total nights and Total_Stay_Amount on the main Accommodation_Tab interface without a page reload.
10. THE Accommodation_Tab SHALL allow the admin to invoke "Recalculate Stay" and "Save Stay Details" any number of times for the same Stay_Entry while its Stay_Status remains ACTIVE.
11. WHEN "Save Stay Details" is invoked AND the resulting Remaining_Balance (the updated Total_Stay_Amount minus Total_Paid) is greater than zero, THE Accommodation_Tab SHALL display the "Record Payment" form described in Requirement 5 so the admin can collect the remaining amount.
12. WHEN "Save Stay Details" is invoked AND Total_Paid exceeds the updated Total_Stay_Amount, THE Accommodation_Tab SHALL display a "Mark as refunded" action, following the behavior described in Requirement 14.
13. THE System SHALL enable the "Mark as Checked Out" action described in Requirement 7 for a Stay_Entry exactly when its Remaining_Balance is zero and the current IST date is on or after its Computed_End_Date (Recalculated_End_Date when Save_Stay_Details has been applied), consistent with the existing checkout gating rules — "Recalculate Stay" and "Save Stay Details" do not introduce a separate or earlier path to Stay_Status FINISHED.
14. IF the admin attempts to invoke "Recalculate Stay", "Save Stay Details", or Stay_Extension for a Stay_Entry that is not in Stay_Status ACTIVE, THEN THE System SHALL reject the operation, consistent with existing status-based rejection behavior for non-ACTIVE stays.
15. THE System SHALL retain the Stay_Entry's originally booked total nights and originally booked Total_Stay_Amount value (as they stood before the first "Save Stay Details" invocation) in the payment/stay history so that the audit trail reflects both the originally booked figures and the recalculated figures, unaffected by any subsequent "Save Stay Details" invocation.
16. IF a system or server failure occurs after the admin invokes "Save Stay Details" but before the recomputed total nights, Total_Stay_Amount, and related updates are fully persisted, THEN THE System SHALL discard any partial changes so the Stay_Entry's total nights, Total_Stay_Amount, Stay_Status, and Computed_End_Date remain unchanged from their pre-submission values, and THE Accommodation_Tab SHALL display an error message indicating that the save did not complete, allowing the admin to retry "Save Stay Details" without loss of the previously saved stay data.

### Requirement 13: Recalculation History

**User Story:** As an admin, I want every stay recalculation to be recorded in its own history list, so that I can audit exactly when and how a stay's nights or amount were adjusted, separately from stay extensions.

#### Acceptance Criteria

1. WHEN the admin invokes "Save Stay Details" for a Stay_Entry and the submission changes the total nights, the Total_Stay_Amount, or both from their values immediately before the invocation, THE System SHALL record one Recalculation_History entry capturing the total nights and Total_Stay_Amount immediately before the submission, the total nights and Total_Stay_Amount immediately after the submission, and the current date.
2. IF the admin invokes "Save Stay Details" for a Stay_Entry and neither the total nights nor the Total_Stay_Amount differs from their values immediately before the invocation, THEN THE System SHALL NOT record a Recalculation_History entry for that invocation.
3. THE Accommodation_Tab SHALL display Recalculation_History entries for a Stay_Entry in a dedicated history list, distinct from the existing Extension History list described for Stay_Extension.
4. WHEN a Stay_Entry has zero Recalculation_History entries, THE Accommodation_Tab SHALL display the dedicated history list in an empty state indicating that no recalculations have been recorded for that Stay_Entry.
5. THE Accommodation_Tab SHALL display Recalculation_History entries for a Stay_Entry in ascending chronological order by the recorded date, with the oldest entry displayed first and the most recently recorded entry displayed last, showing for each entry the date, the total nights before and after, and the Total_Stay_Amount before and after.
6. IF the admin invokes a Stay_Extension for a Stay_Entry, THEN THE System SHALL NOT record a Recalculation_History entry for that invocation.
7. IF the admin invokes "Save Stay Details" for a Stay_Entry, THEN THE System SHALL NOT record an Extension History entry for that invocation.

### Requirement 14: Refund Recording and Refund Invoice Within Stay Recalculation

**User Story:** As an admin, I want to record a refund and receive a distinct refund document whenever a stay recalculation results in the guest having paid more than the recalculated total, so that the excess payment is accounted for and documented before checkout.

#### Acceptance Criteria

1. WHILE a Stay_Entry's Stay_Status is ACTIVE and its Total_Paid exceeds its current Total_Stay_Amount, THE Accommodation_Tab SHALL display a "Mark as refunded" action, pre-filled with a refund amount equal to the excess (Total_Paid minus Total_Stay_Amount) and a required remark field (maximum 500 characters) describing how the refund was initiated.
2. THE Accommodation_Tab SHALL render the "Mark as refunded" refund amount field as a numeric input accepting values from 1 up to the current excess amount.
3. IF the admin submits "Mark as refunded" without a remark, or with a remark exceeding 500 characters, or with a comment exceeding 500 characters, THEN THE Accommodation_Tab SHALL reject the submission and display an error message indicating the missing or invalid field.
4. IF the admin submits a "Mark as refunded" action with a refund amount that is not a positive number or that exceeds the Stay_Entry's current excess amount (Total_Paid minus Total_Stay_Amount) at the time of submission, THEN THE System SHALL reject the submission, make no changes to the Stay_Entry's Payment_Transaction records, and display an error message indicating the refund amount is out of the allowed range.
5. IF the admin submits a "Mark as refunded" action for a Stay_Entry whose Total_Paid no longer exceeds its Total_Stay_Amount at the time of submission, THEN THE System SHALL reject the submission, make no changes to the Stay_Entry's Payment_Transaction records, and display an error message indicating there is no excess payment to refund.
6. WHEN the admin submits a valid "Mark as refunded" action, THE System SHALL record one Payment_Transaction of type REFUND for the Stay_Entry with the entered refund amount, the required remark, an optional comment, and the current date.
7. WHEN a Payment_Transaction of type REFUND is recorded through "Mark as refunded", THE System SHALL generate exactly one Refund_Invoice for that Payment_Transaction, showing the refunded amount, the remark, the date, and a reference to the Stay_Entry.
8. IF Refund_Invoice generation fails after a REFUND Payment_Transaction has been recorded, THEN THE System SHALL roll back the recorded Payment_Transaction, make no lasting change to the Stay_Entry's Total_Paid, and display an error message indicating the refund could not be completed.
9. THE System SHALL allow more than one Refund_Invoice to exist for the same Stay_Entry, at most one per REFUND Payment_Transaction recorded against it.
10. WHEN a "Mark as refunded" submission results in Total_Paid equal to the Stay_Entry's current Total_Stay_Amount, THE System SHALL make the Stay_Entry eligible for "Mark as Checked Out" under the gating rules described in Requirement 12, without itself transitioning the Stay_Entry's Stay_Status.
