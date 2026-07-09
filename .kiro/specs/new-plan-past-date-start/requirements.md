# Requirements Document

## Introduction

This feature adds past-date start date selection logic to the **AdminAddSubscriptionForm** (the form used when an admin adds a new subscription plan for an existing customer whose previous plan expired or who needs a new plan). It mirrors the past-date functionality already implemented in QuickOnboardingForm but constrains the selectable date range to dates after the previous/expired subscription's end date to prevent overlap. Additionally, it introduces the Past Day Status popup for capturing delivery history and enforces the 5 PM IST cutoff with an automation-override acknowledgment when selecting tomorrow's date after cutoff.

## Glossary

- **Admin_Add_Subscription_Form**: The client-side form component (`AdminAddSubscriptionForm.tsx`) used by admins to create a new subscription for an existing customer.
- **Past_Date_Mode**: A toggle state in the form that, when enabled, allows selection of past dates as the subscription start date.
- **Past_Day_Status_Popup**: A reusable dialog component (`PastDayStatusPopup.tsx`) that collects delivery status (Delivered/Skipped) with meal type and address for each past day.
- **Previous_Subscription_End_Date**: The `effective_end_on` (or `ends_on`) date of the customer's most recent expired or completed subscription.
- **Active_Subscription**: A subscription with status "ACTIVE" for the given customer.
- **Cutoff_Time**: 17:00 IST — the operational deadline after which the earliest future start date shifts from tomorrow to day-after-tomorrow.
- **Automation_Override_Acknowledgment**: A checkbox the admin must check to confirm that operations will need to re-run automation when adding a subscription after cutoff with tomorrow as start date.
- **IST**: Indian Standard Time (UTC+05:30).
- **Server_Action**: The server-side function (`addSubscription` in `adminSubscriptionActions.ts`) that validates and persists the new subscription.
- **Past_Day_Status_Boundary**: The last date (inclusive) for which delivery status can be confirmed, determined by the 5 PM cutoff logic.
- **Cascade_Pending_Subscription_Dates**: Existing logic in `manageMealActions.ts` that automatically shifts pending subscription start dates when an active plan's end date changes due to a pause.

## Requirements

### Requirement 1: Past Date Toggle in Admin Add Subscription Form

**User Story:** As an admin, I want to toggle a "Past date start date" option in the Add New Subscription form, so that I can set a subscription start date in the past for customers whose previous plan expired.

#### Acceptance Criteria

1. THE Admin_Add_Subscription_Form SHALL display a "Past date start date" toggle (switch/checkbox) in the start date section, defaulting to the disabled (off) state each time the form is opened.
2. WHILE Past_Date_Mode is disabled, THE Admin_Add_Subscription_Form SHALL restrict the start date input to dates on or after the earliest future start date as determined by the Cutoff_Time logic (tomorrow if before 17:00 IST, day-after-tomorrow if at or after 17:00 IST).
3. IF Past_Date_Mode is enabled AND a Previous_Subscription_End_Date exists AND the Previous_Subscription_End_Date is within the last 30 days, THEN THE Admin_Add_Subscription_Form SHALL allow selection of past dates from the day after the Previous_Subscription_End_Date up to and including yesterday (IST).
4. IF Past_Date_Mode is enabled AND a Previous_Subscription_End_Date exists AND the Previous_Subscription_End_Date is more than 30 days ago, THEN THE Admin_Add_Subscription_Form SHALL allow selection of past dates from 30 days before today (IST) up to and including yesterday (IST).
5. IF Past_Date_Mode is enabled AND no Previous_Subscription_End_Date exists, THEN THE Admin_Add_Subscription_Form SHALL allow selection of past dates from 30 days before today (IST) up to and including yesterday (IST).
6. IF an Active_Subscription exists for the customer, THEN THE Admin_Add_Subscription_Form SHALL NOT display the Past_Date_Mode toggle.

### Requirement 2: Past Date Range Constraint — No Overlap

**User Story:** As an admin, I want the past date selection to be constrained to dates after the previous subscription's end date, so that two subscriptions cannot have overlapping active dates.

#### Acceptance Criteria

1. WHEN Past_Date_Mode is enabled AND a Previous_Subscription_End_Date exists, THE Admin_Add_Subscription_Form SHALL set the earliest selectable past date to one day after the Previous_Subscription_End_Date.
2. WHEN Past_Date_Mode is enabled, THE Admin_Add_Subscription_Form SHALL set the latest selectable past date to yesterday in IST.
3. IF Past_Date_Mode is enabled AND the Previous_Subscription_End_Date is yesterday (IST) or a future date, THEN THE Admin_Add_Subscription_Form SHALL disable the Past_Date_Mode toggle and display a message indicating that no valid past dates are available.
4. THE Admin_Add_Subscription_Form SHALL disable all calendar dates whose selection would cause the new subscription's date range (start_date through end_date inclusive) to share one or more calendar days with any existing ACTIVE or PENDING subscription's date range (starts_on through effective_end_on inclusive) for the same customer.
5. IF the admin submits the form AND the computed new subscription date range overlaps with any existing ACTIVE or PENDING subscription for the same customer, THEN THE Admin_Add_Subscription_Form SHALL reject the submission and display an error message indicating the overlap conflict.

### Requirement 3: Past Day Status Popup

**User Story:** As an admin, I want to fill delivery status for each past day when selecting a past start date, so that delivery records are accurate from day one of the new subscription.

#### Acceptance Criteria

1. WHEN the admin attempts to submit the form with a past start date selected, THE Admin_Add_Subscription_Form SHALL open the Past_Day_Status_Popup before proceeding with submission.
2. THE Past_Day_Status_Popup SHALL display one row for each date from the selected past start date up to and including the Past_Day_Status_Boundary date (maximum 30 rows).
3. WHEN the current IST time is at or after Cutoff_Time (17:00 IST), THE Past_Day_Status_Boundary SHALL be today's IST date.
4. WHEN the current IST time is before Cutoff_Time (17:00 IST), THE Past_Day_Status_Boundary SHALL be yesterday's IST date.
5. Each row in the Past_Day_Status_Popup SHALL require a meal status selection of either "Delivered" or "Skipped". IF "Delivered" is selected, THEN the row SHALL additionally require a meal type (VEG, EGG, or CHICKEN) and a delivery address (Primary or Secondary).
6. WHEN the admin confirms the Past_Day_Status_Popup with valid entries for all days, THE Admin_Add_Subscription_Form SHALL include the past day statuses in the submission payload.
7. WHEN the admin cancels the Past_Day_Status_Popup, THE Admin_Add_Subscription_Form SHALL NOT proceed with form submission and SHALL return the admin to the form.

### Requirement 4: After-5PM Cutoff Logic and Automation Override

**User Story:** As an admin, I want to be alerted when adding a subscription after 5 PM IST with tomorrow as the start date, so that I acknowledge the need for operations to re-run automation.

#### Acceptance Criteria

1. WHEN the current IST time is at or after Cutoff_Time (17:00 IST) AND the selected start date is tomorrow (IST today + 1 day), THE Admin_Add_Subscription_Form SHALL display an alert informing the admin that operations will need to re-run the delivery automation for the new subscription to take effect.
2. WHILE the alert described in criterion 1 is visible, THE alert SHALL include a checkbox labeled Automation_Override_Acknowledgment that is unchecked by default.
3. WHILE the Automation_Override_Acknowledgment checkbox is unchecked AND the alert is visible, THE Admin_Add_Subscription_Form SHALL disable the submit button.
4. WHEN the admin checks the Automation_Override_Acknowledgment checkbox, THE Admin_Add_Subscription_Form SHALL enable the submit button.
5. WHEN the admin unchecks the Automation_Override_Acknowledgment checkbox, THE Admin_Add_Subscription_Form SHALL disable the submit button.
6. WHEN the selected start date changes away from tomorrow OR the current IST time transitions to before Cutoff_Time (e.g., due to date rollover), THE Admin_Add_Subscription_Form SHALL hide the alert, uncheck the Automation_Override_Acknowledgment checkbox, and re-enable the submit button.

### Requirement 5: Server-Side Validation for Past Date Submissions

**User Story:** As the system, I want to validate past-date subscription submissions on the server, so that data integrity is maintained regardless of client-side behavior.

#### Acceptance Criteria

1. WHEN a past start date is submitted, THE Server_Action SHALL accept the start date if it is after the Previous_Subscription_End_Date for the customer. IF no Previous_Subscription_End_Date exists, THEN the Server_Action SHALL accept dates within the last 30 days.
2. WHEN a past start date is submitted AND the start date or computed date range overlaps with any non-cancelled subscription (ACTIVE, PENDING, or EXPIRED with overlapping dates), THE Server_Action SHALL reject the submission with a descriptive error message specifying the conflicting subscription's date range.
3. WHEN a past start date is submitted, THE Server_Action SHALL skip the standard "start date must be tomorrow or later" check (using the existing `skipStartDateCheck` option mechanism).
4. WHEN a past start date is submitted with past day statuses, THE Server_Action SHALL validate that: (a) each entry's date falls within the range from start date to Past_Day_Status_Boundary (inclusive), (b) each entry has a meal status of "Delivered" or "Skipped", (c) entries with "Delivered" status include a valid meal type (VEG, EGG, or CHICKEN) and delivery address (Primary or Secondary), and (d) the total number of entries is between 1 and 30.
5. WHEN a past start date is submitted without past day statuses covering all required days (from start date through Past_Day_Status_Boundary), THE Server_Action SHALL reject the submission with an error message indicating the missing day statuses.

### Requirement 6: Cascade Pending Subscription Dates Verification

**User Story:** As the system, I want to confirm that the existing cascade logic for pending subscriptions is preserved, so that when an active plan's end date changes due to a pause, pending subscription start dates shift accordingly.

#### Acceptance Criteria

1. WHEN an active subscription's effective_end_on changes due to pause reconciliation, THE System SHALL invoke the cascade logic to set the first PENDING subscription's starts_on to one day after the new effective_end_on, and each subsequent PENDING subscription's starts_on to one day after the previous PENDING subscription's ends_on, updating starts_on, ends_on, and effective_end_on for each affected PENDING subscription in created_at ascending order.
2. THE past-date subscription feature SHALL invoke the same cascadePendingSubscriptionDates function with the same parameters and produce the same date-shifting results as subscriptions created with future start dates, without altering the function's signature, query logic, or update sequence.
3. WHEN a new subscription is created with a past start date (up to 30 days in the past) AND no ACTIVE subscription exists for the customer, THE System SHALL set the new subscription's status to ACTIVE and invoke the cascade logic using its effective_end_on as the baseEndDate so that any existing PENDING subscriptions shift their dates accordingly.
4. WHEN a new subscription is created with a past start date AND an ACTIVE subscription already exists for the customer, THE System SHALL set the new subscription's status to PENDING and position its starts_on to one day after the current ACTIVE subscription's effective_end_on, then cascade all subsequent PENDING subscriptions after it.
5. IF the cascade logic encounters a database error while updating a PENDING subscription mid-chain, THEN THE System SHALL throw the error and halt further cascade processing, leaving previously updated subscriptions in their new state.
