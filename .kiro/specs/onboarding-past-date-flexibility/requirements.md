# Requirements Document

## Introduction

This feature extends the ArogyaDiet admin Quick Onboarding process to support past-date subscription starts. Currently, the system enforces a forward-only start date policy (tomorrow or day-after-tomorrow based on the 5 PM IST cutoff). In practice, admins often need to onboard customers whose subscriptions have already begun — for example, a customer who purchased on July 1st but the admin creates the entry on July 8th. Additionally, the existing 5 PM cutoff preventing tomorrow selection is relaxed for admin users who can coordinate with operations to re-run automations.

## Glossary

- **Quick_Onboarding_Form**: The 4-step admin wizard (Details → Category & Plan → Address → Payment & Review) used to create new customer subscriptions
- **Past_Date_Start**: A subscription start date that falls before the current IST date
- **Past_Day_Status_Popup**: A modal dialog that captures the delivery status for each day between the past start date and today
- **Meal_Status**: The delivery outcome for a past day — either "Delivered" or "Skipped"
- **Meal_Type**: The meal category for a past day — VEG, EGG, or CHICKEN
- **Delivery_Address**: The address used for a past day delivery — Primary or Secondary
- **Cutoff_Time**: 17:00 IST, the operational deadline that determines start date eligibility
- **Effective_End_Date**: The adjusted subscription end date after accounting for paused/skipped days
- **Automation_Override_Acknowledgment**: A confirmation checkbox the admin checks to accept responsibility for re-running delivery automations when selecting tomorrow after 5 PM
- **Daily_Preferences**: Records in `subscription_daily_preferences` table representing each day's meal configuration
- **Pause_Credit**: A credit applied when a day is marked as skipped, extending the subscription end date by one day

## Requirements

### Requirement 1: Past Date Start Date Activation

**User Story:** As an admin, I want to enable past date selection during onboarding, so that I can onboard customers whose subscriptions have already started.

#### Acceptance Criteria

1. WHEN the admin is on Step 2 (Category & Plan) of the Quick_Onboarding_Form, THE Quick_Onboarding_Form SHALL display a "Past date start date" checkbox below the start date dropdown
2. WHEN the admin checks the "Past date start date" checkbox, THE Quick_Onboarding_Form SHALL enable selection of dates from 30 days before the current IST date up to and including yesterday (current IST date minus 1 day) in the start date dropdown, while disabling selection of today and future dates
3. WHILE the "Past date start date" checkbox is unchecked, THE Quick_Onboarding_Form SHALL maintain the existing start date validation rules (earliest selectable date based on Cutoff_Time)
4. IF the admin unchecks the "Past date start date" checkbox after a past start date has been selected, THEN THE Quick_Onboarding_Form SHALL clear the selected start date, revert the start date dropdown to the existing Cutoff_Time-based validation rules, and discard any previously captured Past_Day_Status_Popup entries
5. WHEN the admin selects a past start date and attempts to advance to Step 3, THE Quick_Onboarding_Form SHALL display the Past_Day_Status_Popup before advancing to the next step

### Requirement 2: Past Day Status Capture

**User Story:** As an admin, I want to record the meal delivery status for each past day, so that the subscription daily preferences reflect actual history.

#### Acceptance Criteria

1. WHEN the Past_Day_Status_Popup opens, THE Past_Day_Status_Popup SHALL display one entry row for each calendar day from the selected past start date up to and including the current IST date, with all Meal_Status, Meal_Type, and Delivery_Address fields in an unselected state
2. THE Past_Day_Status_Popup SHALL require the admin to select a Meal_Status (Delivered or Skipped) for each past day
3. THE Past_Day_Status_Popup SHALL require the admin to select a Meal_Type (VEG, EGG, or CHICKEN) for each past day marked as Delivered
4. THE Past_Day_Status_Popup SHALL require the admin to select a Delivery_Address (Primary or Secondary) for each past day marked as Delivered
5. WHEN the admin marks a past day as Skipped, THE Past_Day_Status_Popup SHALL disable the Meal_Type and Delivery_Address fields for that day and clear any previously selected values in those fields
6. WHEN the admin has selected a Meal_Status for a day AND has selected Meal_Type and Delivery_Address if that day is marked Delivered, THE Past_Day_Status_Popup SHALL display a "Fill same status for all remaining days" button that copies from that most recently completed day to all days that do not yet have a Meal_Status selected
7. WHEN the admin clicks "Fill same status for all remaining days," THE Past_Day_Status_Popup SHALL copy the Meal_Status, Meal_Type, and Delivery_Address from the most recently completed day to all days that do not yet have a Meal_Status selected
8. WHEN the admin has selected a valid Meal_Status for every past day AND has selected Meal_Type and Delivery_Address for every day marked as Delivered, THE Past_Day_Status_Popup SHALL enable the "Confirm" button to proceed
9. IF the admin dismisses or closes the Past_Day_Status_Popup without clicking "Confirm," THEN THE Past_Day_Status_Popup SHALL discard all entered statuses and return the admin to the start date selection without advancing to the next step
10. WHILE the Past_Day_Status_Popup is open, THE Past_Day_Status_Popup SHALL allow the admin to change any previously selected Meal_Status, Meal_Type, or Delivery_Address for any day before clicking "Confirm"

### Requirement 3: Past Date After-5PM Boundary

**User Story:** As an admin, I want the past day status capture to correctly handle the after-5PM scenario, so that only days with a definitive delivery outcome are recorded.

#### Acceptance Criteria

1. WHILE the current IST time is at or after 17:00 (Cutoff_Time) AND the admin has selected a past start date, THE Past_Day_Status_Popup SHALL display entries from the past start date up to and including the current IST date only (excluding tomorrow)
2. WHILE the current IST time is before 17:00 (Cutoff_Time) AND the admin has selected a past start date, THE Past_Day_Status_Popup SHALL display entries from the past start date up to and including the current IST date only (excluding today's delivery which has not yet been confirmed)
3. WHEN the admin submits a past-date onboarding, THE Onboarding_Service SHALL generate Daily_Preferences for all days from the past start date through the subscription effective_end_on date, using the captured statuses for past days and the initial meal preference for future days

### Requirement 4: Skipped Days Extend Subscription End Date

**User Story:** As an admin, I want skipped days in the past period to extend the subscription end date, so that the customer receives the full number of paid delivery days.

#### Acceptance Criteria

1. WHEN the admin confirms the Past_Day_Status_Popup with one or more days marked as Skipped, THE Onboarding_Service SHALL increase the subscription effective_end_on date by the count of skipped days and create Daily_Preferences records for each newly appended day using the initial meal preference and primary address
2. WHEN the admin confirms the Past_Day_Status_Popup with one or more days marked as Skipped, THE Onboarding_Service SHALL set is_paused to true and pause_credit_used to true for each skipped day in the Daily_Preferences
3. WHEN the admin confirms the Past_Day_Status_Popup with one or more days marked as Skipped, THE Onboarding_Service SHALL increment pause_credits_used on the subscription by the count of skipped days, and these skipped days SHALL NOT reduce the customer's available pause_credits for future use
4. WHEN all past days are marked as Delivered, THE Onboarding_Service SHALL retain the original subscription effective_end_on date without modification
5. THE Onboarding_Service SHALL calculate the total subscription duration as: plan duration days + count of skipped past days
6. IF any one of the effective_end_on date extension, Daily_Preferences marking, or pause_credits_used increment fails during confirmation, THEN THE Onboarding_Service SHALL roll back all changes from that confirmation so that no partial update persists, and SHALL return an error indication that the operation did not complete

### Requirement 5: Tomorrow Selection After 5PM Override

**User Story:** As an admin, I want to select tomorrow as the start date even after 5 PM, so that I can onboard customers for next-day delivery when operations confirms the automation will be re-run.

#### Acceptance Criteria

1. WHILE the current IST time is at or after 17:00 (Cutoff_Time), THE Quick_Onboarding_Form SHALL allow the admin to select tomorrow as the start date in the date picker on Step 2, in addition to the existing day-after-tomorrow option
2. WHEN the admin selects tomorrow as the start date after 17:00 IST, THE Quick_Onboarding_Form SHALL display the Automation_Override_Acknowledgment checkbox on Step 4 (Payment & Review)
3. THE Automation_Override_Acknowledgment checkbox SHALL display the text: "I understand automation needs to run again by operation admin. I have received confirmation from process admin to process this onboarding customer."
4. WHILE the Automation_Override_Acknowledgment checkbox is unchecked AND the admin has selected tomorrow after 17:00 IST, THE Quick_Onboarding_Form SHALL disable the Onboard CTA button on Step 4
5. WHEN the admin checks the Automation_Override_Acknowledgment checkbox AND tomorrow is selected as the start date after 17:00 IST, THE Quick_Onboarding_Form SHALL enable the Onboard CTA button on Step 4 (provided no other validation errors exist on the form)
6. WHILE the current IST time is before 17:00 (Cutoff_Time), THE Quick_Onboarding_Form SHALL retain the existing behavior where tomorrow is already the earliest selectable date
7. WHEN the admin changes the start date from tomorrow to day-after-tomorrow on Step 2 (after previously selecting tomorrow post-17:00 IST), THE Quick_Onboarding_Form SHALL hide the Automation_Override_Acknowledgment checkbox on Step 4 and re-enable the Onboard CTA button (subject to standard form validation)
8. THE Quick_Onboarding_Form SHALL evaluate the current IST time against Cutoff_Time at the moment the date picker is rendered on Step 2, not dynamically while the form is open

### Requirement 6: Past Date Daily Preferences Generation

**User Story:** As an admin, I want the system to generate correct daily preference records for past-date onboardings, so that operational history is accurate and future automations work correctly.

#### Acceptance Criteria

1. WHEN the admin submits a past-date onboarding, THE Onboarding_Service SHALL create one Daily_Preferences record for each past day (from start date up to and including the current IST date) using the Meal_Status, Meal_Type, and Delivery_Address captured in the Past_Day_Status_Popup
2. WHEN the admin submits a past-date onboarding, THE Onboarding_Service SHALL create one Daily_Preferences record for each future day (from tomorrow through the effective_end_on date) using the initial meal preference (initial_meal_category_id) and primary address (delivery_address_id)
3. WHEN a past day was marked as Delivered, THE Onboarding_Service SHALL set is_paused to false, pause_credit_used to false, and assign the selected meal_category_id and delivery_address_id for that day's Daily_Preferences record
4. WHEN a past day was marked as Skipped, THE Onboarding_Service SHALL set is_paused to true, pause_credit_used to true, meal_category_id to the initial meal preference, and delivery_address_id to the primary address for that day's Daily_Preferences record
5. THE Onboarding_Service SHALL validate that the total count of Daily_Preferences records equals the plan duration days (total_days) plus the count of skipped past days before persisting
6. IF the Daily_Preferences record count does not equal plan duration days plus skipped past days count, THEN THE Onboarding_Service SHALL reject the submission with an error message indicating the record count mismatch
7. WHEN the admin submits a past-date onboarding, THE Onboarding_Service SHALL create all Daily_Preferences records within a single transaction, rolling back all records if any insertion fails

### Requirement 7: Server-Side Past Date Validation

**User Story:** As an admin, I want the server to validate past-date onboarding inputs, so that invalid data cannot be persisted regardless of client-side behavior.

#### Acceptance Criteria

1. WHEN the payload contains a start date earlier than the current IST date AND the pastDateEnabled flag is false, THE Onboarding_Action SHALL reject the request with an error message indicating that past-date mode must be enabled
2. WHEN the payload contains a start date more than 30 calendar days before the current IST date (i.e., startDate < today minus 30 days), THE Onboarding_Action SHALL reject the request with an error message indicating the date exceeds the maximum past range
3. WHEN the payload contains a past start date AND the pastDayStatuses array is missing or contains zero entries, THE Onboarding_Action SHALL reject the request with an error message indicating that past day statuses are required
4. WHEN the payload contains pastDayStatuses with an entry count that does not equal the number of calendar days from startDate to the current IST date inclusive, THE Onboarding_Action SHALL reject the request with an error message indicating the day count mismatch
5. WHEN a pastDayStatuses entry has Meal_Status of Delivered but is missing Meal_Type or Delivery_Address, THE Onboarding_Action SHALL reject the request with field-level errors identifying each incomplete entry by its date
6. IF any pastDayStatuses entry contains a date value that falls outside the range from startDate to the current IST date inclusive or is a duplicate of another entry's date, THEN THE Onboarding_Action SHALL reject the request with an error message indicating the invalid date entry
7. IF the server-side validation fails for any past-date field, THEN THE Onboarding_Action SHALL return the response in the existing action result format (success: false) with per-field error messages keyed by field path so the Quick_Onboarding_Form can display them inline

### Requirement 8: Past Date Onboarding Schema Extension

**User Story:** As a developer, I want the onboarding validation schema to support past-date fields, so that both client and server validate the new inputs consistently.

#### Acceptance Criteria

1. THE Onboarding_Schema SHALL include a boolean field `pastDateEnabled` that defaults to false
2. THE Onboarding_Schema SHALL include an array field `pastDayStatuses` containing objects with fields: date (YYYY-MM-DD ISO date string), mealStatus (enum: "Delivered" or "Skipped"), mealType (enum: "VEG", "EGG", or "CHICKEN", required when mealStatus is "Delivered"), and deliveryAddress (enum: "Primary" or "Secondary", required when mealStatus is "Delivered")
3. WHEN `pastDateEnabled` is true, THE Onboarding_Schema SHALL require the `pastDayStatuses` array to contain at least one entry and at most 30 entries
4. WHEN `pastDateEnabled` is true, THE Onboarding_Schema SHALL require the `startDate` field value to be earlier than the current IST date and within 30 calendar days of the current IST date
5. WHEN `pastDateEnabled` is false, THE Onboarding_Schema SHALL enforce the existing start date validation (on or after the earliest selectable date based on Cutoff_Time) and SHALL NOT require the `pastDayStatuses` array
6. THE Onboarding_Schema SHALL include a boolean field `automationOverrideAcknowledged` that defaults to false
7. WHEN `automationOverrideAcknowledged` is true, THE Onboarding_Schema SHALL allow the start date to be tomorrow even when the current IST time is at or after 17:00
