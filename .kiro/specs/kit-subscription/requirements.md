# Requirements Document

## Introduction

KIT customers (Customer_Category = "KIT") currently see only a static "My KIT Order" dashboard with product, timeline, and shipping details. This feature adds a new daily interaction facility — the **KIT Tracker** — as a dedicated navigation section in the customer sidebar. It lets KIT customers confirm receipt of their physical package (a one-time action that establishes the tracker start date), then log a daily Food_Taken/Food_Skipped status on a calendar view, optionally recording physical activity and weight when food is taken. Skipping a day automatically extends the tracker's end date by one day; reversing a skip reduces it symmetrically. A matching read-only view is added to the Admin Portal's existing "KIT" tab on the customer profile, replacing the current placeholder, so admins can see the same daily tracking data without any editing controls. The feature is fully isolated from Meal_Subscription data and business rules, consistent with the isolation architecture established in the kit-subscription-management spec.

## Glossary

- **KIT_Subscription**: A subscription record where `customer_category = 'KIT'`.
- **Customer_Category**: Existing classification field on subscriptions (`MEAL`, `KIT`, `ACCOMMODATION`).
- **KIT_Duration_Days**: Existing `kit_duration_days` field on a KIT_Subscription representing the purchased package length in days.
- **KIT_Tracker**: The new customer-facing navigation section (sidebar item) providing daily interaction with a KIT_Subscription.
- **Package_Receipt_Screen**: The one-time confirmation screen shown before a Received_Date has been recorded, containing the "Mark KIT Received" action and a date picker.
- **Received_Date**: The date the customer confirms as when the KIT package was received. Once persisted, it becomes the tracker start date. It remains editable until the first Daily_Log is saved for the KIT_Subscription, after which it is locked.
- **Daily_Tracker_Calendar**: The calendar-grid view (shown after Received_Date is confirmed) displaying and allowing entry of daily status from Received_Date through Tracker_End_Date.
- **Daily_Log**: A persisted record of one KIT_Subscription's status for one calendar date, consisting of a required status (Food_Taken or Food_Skipped) and, when applicable, optional Physical_Activity_Minutes, Physical_Activity_Name, and Weight_Kg.
- **Food_Taken**: Daily_Log status indicating the customer consumed the KIT meal on that date.
- **Food_Skipped**: Daily_Log status indicating the customer did not consume the KIT meal on that date.
- **Physical_Activity_Minutes**: Optional numeric field (minutes) on a Food_Taken Daily_Log.
- **Physical_Activity_Name**: Optional free-text field describing the activity type, entered alongside Physical_Activity_Minutes.
- **Weight_Kg**: Optional numeric field (kilograms) on a Food_Taken Daily_Log.
- **Total_Skipped_Days**: The count of Daily_Log records with status Food_Skipped for a given KIT_Subscription.
- **Tracker_End_Date**: The last date of the active tracking window, computed as Received_Date plus (KIT_Duration_Days minus 1) days, plus Total_Skipped_Days.
- **Editable_Window**: The set of dates for which the customer may create or modify a Daily_Log — every date from Received_Date through the current date, inclusive, and never a future date.
- **Admin_Portal**: Existing desktop-first operations interface.
- **Customer_Portal**: Existing customer-facing interface.
- **Admin_KIT_Tab**: The read-only view of KIT_Tracker data shown under the "KIT" tab of a customer's profile in the Admin_Portal, replacing the current "Day-wise progress tracking coming soon" placeholder.
- **Meal_Subscription**: Existing recurring subscription system for daily meal deliveries, governed by separate business rules (pause credits, daily meal preferences, delivery batches).

## Requirements

### Requirement 1: KIT Tracker Navigation Visibility

**User Story:** As a KIT customer, I want a dedicated "KIT Tracker" section in my sidebar, so that I can access daily package tracking separately from my static order dashboard.

#### Acceptance Criteria

1. WHERE a customer's Customer_Category is "KIT", THE Customer_Portal SHALL display a "KIT Tracker" navigation item in the customer sidebar.
2. WHERE a customer's Customer_Category is not "KIT", THE Customer_Portal SHALL NOT display the "KIT Tracker" navigation item.
3. IF a customer whose Customer_Category is not "KIT" requests the KIT_Tracker route directly (including via bookmark or typed URL), THEN THE Customer_Portal SHALL redirect the customer to the default customer dashboard and display a message indicating the KIT Tracker is unavailable.
4. IF a customer whose Customer_Category is "KIT" has no KIT_Subscription record, THEN THE KIT_Tracker SHALL display a message indicating no KIT subscription was found and SHALL NOT render the Package_Receipt_Screen or Daily_Tracker_Calendar.
5. WHEN a KIT customer selects "KIT Tracker" or requests the KIT_Tracker route directly, AND no Received_Date has been persisted for the customer's KIT_Subscription, THE KIT_Tracker SHALL display the Package_Receipt_Screen.
6. WHEN a KIT customer selects "KIT Tracker" or requests the KIT_Tracker route directly, AND a Received_Date has already been persisted for the customer's KIT_Subscription, THE KIT_Tracker SHALL display the Daily_Tracker_Calendar.

### Requirement 2: One-Time Package Receipt Confirmation

**User Story:** As a KIT customer, I want to confirm the date I received my package, so that my daily tracker starts from the correct date.

#### Acceptance Criteria

1. THE Package_Receipt_Screen SHALL display a single action labeled "Mark KIT Received" together with a date picker for selecting the Received_Date.
2. THE Package_Receipt_Screen SHALL default the date picker value to the current date.
3. IF the customer selects a Received_Date later than the current date, THEN THE Package_Receipt_Screen SHALL reject the selection, retain the previously selected valid date, and display an error message indicating the date cannot be in the future.
4. IF the customer selects a Received_Date earlier than the KIT_Subscription's start date, THEN THE Package_Receipt_Screen SHALL reject the selection, retain the previously selected valid date, and display an error message indicating the date is out of the allowed range.
5. WHEN the customer selects the "Mark KIT Received" action with a valid Received_Date, THE System SHALL persist the Received_Date for that KIT_Subscription.
6. IF persisting the Received_Date fails due to a system error, THEN THE System SHALL display an error message indicating the confirmation could not be completed and SHALL retain the customer on the Package_Receipt_Screen with the selected Received_Date preserved for retry.
7. WHILE a KIT_Subscription has a persisted Received_Date and no Daily_Log has yet been saved for that KIT_Subscription, THE System SHALL allow the customer to navigate back to the Package_Receipt_Screen from the Daily_Tracker_Calendar and re-confirm or change the Received_Date, subject to the same date validation rules defined in Criteria 3 and 4.
8. IF at least one Daily_Log has been saved for a KIT_Subscription, THEN THE System SHALL make the Received_Date non-editable by preventing navigation back to the Package_Receipt_Screen for that KIT_Subscription and SHALL reject any attempt to modify the Received_Date with an error message indicating the date is locked.
9. WHEN the Received_Date is confirmed, THE KIT_Tracker SHALL transition from the Package_Receipt_Screen to the Daily_Tracker_Calendar.

### Requirement 3: Daily Tracker Calendar Initialization and Display

**User Story:** As a KIT customer, I want to see a calendar view of my tracking period, so that I can review and log my daily status in a familiar format.

#### Acceptance Criteria

1. WHEN the Daily_Tracker_Calendar is displayed for a KIT_Subscription, THE Daily_Tracker_Calendar SHALL render every date from the Received_Date through the current Tracker_End_Date, inclusive, in ascending chronological order.
2. WHILE Total_Skipped_Days equals zero, THE System SHALL compute Tracker_End_Date as Received_Date plus (KIT_Duration_Days minus 1) days.
3. THE Daily_Tracker_Calendar SHALL display the rendered date range as one month-grid card per calendar month spanned by that range, each card showing weekday column headers ordered Sunday through Saturday, consistent with the visual pattern of the Meal_Planner calendar.
4. THE Daily_Tracker_Calendar SHALL be implemented as a component separate from Meal_Planner components and SHALL NOT share business logic with Meal_Subscription features.

### Requirement 4: Daily Status Logging and Editability Window

**User Story:** As a KIT customer, I want to log whether I took or skipped my food each day, so that I can track my adherence over the KIT period.

#### Acceptance Criteria

1. THE Editable_Window SHALL consist of every date from the Received_Date through the current server-clock date, inclusive.
2. WHILE a date falls within the Editable_Window, THE Daily_Tracker_Calendar SHALL allow the customer to set that date's Daily_Log status to Food_Taken or Food_Skipped.
3. IF a date is earlier than the Received_Date or later than the current server-clock date, THEN THE Daily_Tracker_Calendar SHALL prevent the customer from creating or modifying a Daily_Log for that date and SHALL display an error message indicating the date is outside the editable window.
4. THE Daily_Tracker_Calendar SHALL require exactly one status, Food_Taken or Food_Skipped, per logged date.
5. WHEN the customer changes an existing Daily_Log's status within the Editable_Window, THE Daily_Tracker_Calendar SHALL persist the updated status.

### Requirement 5: Food Taken Activity and Weight Details

**User Story:** As a KIT customer, I want to optionally record my physical activity and weight on days I take my food, so that I can monitor my progress.

#### Acceptance Criteria

1. WHEN the customer selects Food_Taken for a date, THE Daily_Tracker_Calendar SHALL display optional input fields for Physical_Activity_Minutes, Physical_Activity_Name, and Weight_Kg.
2. WHEN the customer provides a Physical_Activity_Minutes value, THE Daily_Tracker_Calendar SHALL accept only whole numeric values between 0 and 1440 inclusive.
3. IF the customer provides a Physical_Activity_Minutes value that is non-numeric, contains decimals, or falls outside 0 to 1440, THEN THE Daily_Tracker_Calendar SHALL reject the value, display an error message, and SHALL NOT overwrite the previously saved Physical_Activity_Minutes value.
4. WHEN the customer provides a Physical_Activity_Name value, THE Daily_Tracker_Calendar SHALL accept free text up to 100 characters.
5. WHEN the customer provides a Weight_Kg value, THE Daily_Tracker_Calendar SHALL accept only numeric values between 0 and 500 inclusive, with up to 2 decimal places.
6. IF the customer provides a Weight_Kg value that is non-numeric, has more than 2 decimal places, or falls outside 0 to 500, THEN THE Daily_Tracker_Calendar SHALL reject the value, display an error message, and SHALL NOT overwrite the previously saved Weight_Kg value.
7. THE System SHALL save Physical_Activity_Minutes, Physical_Activity_Name, and Weight_Kg as optional fields on the Daily_Log when status is Food_Taken, and SHALL leave any field the customer did not provide empty rather than substituting a default value.

### Requirement 6: Food Skipped Behavior

**User Story:** As a KIT customer, I want activity and weight fields hidden when I mark a day as skipped, so that I only enter data relevant to that day's status.

#### Acceptance Criteria

1. WHEN the customer selects Food_Skipped for a date, THE Daily_Tracker_Calendar SHALL NOT render the Physical_Activity_Minutes, Physical_Activity_Name, and Weight_Kg input fields for that date, and SHALL exclude any values from those fields from the saved Daily_Log.
2. IF a Daily_Log is saved with status Food_Skipped, THEN THE System SHALL NOT persist Physical_Activity_Minutes, Physical_Activity_Name, or Weight_Kg values for that date, including zero values.
3. THE Daily_Tracker_Calendar SHALL render each Daily_Log status (Food_Taken, Food_Skipped) with a unique icon and background-color combination that is not shared with any other status.
4. WHEN a Daily_Log previously saved with status Food_Taken and populated Physical_Activity_Minutes, Physical_Activity_Name, or Weight_Kg values is changed and saved to Food_Skipped, THE System SHALL clear the previously saved Physical_Activity_Minutes, Physical_Activity_Name, and Weight_Kg values for that date.

### Requirement 7: Calendar Day Display and Skipped Day Count

**User Story:** As a KIT customer, I want each day's cell and a running skip count to clearly show my tracking history, so that I can quickly assess my progress.

#### Acceptance Criteria

1. THE Daily_Tracker_Calendar SHALL display, for each day within the rendered date range that has a recorded Daily_Log, the date number and an icon representing the Food_Taken or Food_Skipped status.
2. THE Daily_Tracker_Calendar SHALL display, for each day within the rendered date range that has no recorded Daily_Log, the date number without a status icon.
3. IF a Daily_Log has status Food_Taken and a Physical_Activity_Minutes value has been logged, THEN THE Daily_Tracker_Calendar SHALL display a physical activity icon together with the Physical_Activity_Minutes value on that day's cell, independent of whether Weight_Kg was logged.
4. IF a Daily_Log has status Food_Taken and a Weight_Kg value has been logged, THEN THE Daily_Tracker_Calendar SHALL display a weight icon together with the Weight_Kg value on that day's cell, independent of whether Physical_Activity_Minutes was logged.
5. THE Daily_Tracker_Calendar SHALL NOT display the Physical_Activity_Name value on the day cell.
6. THE Daily_Tracker_Calendar SHALL display a count of Total_Skipped_Days in a fixed header area above the calendar grid.
7. WHEN a Daily_Log is saved, THE Daily_Tracker_Calendar SHALL update the displayed Total_Skipped_Days without requiring a page reload.

### Requirement 8: Tracker End Date Auto-Extension on Skip

**User Story:** As a KIT customer, I want my tracker's end date to extend automatically when I skip a day, so that I still receive my full number of food days.

#### Acceptance Criteria

1. WHEN a Daily_Log is saved with status Food_Skipped for a date that either has no prior Daily_Log or previously had a status other than Food_Skipped, THE System SHALL increment Total_Skipped_Days by one.
2. WHEN Total_Skipped_Days increments, THE System SHALL recompute and persist Tracker_End_Date as Received_Date plus (KIT_Duration_Days minus 1) days plus Total_Skipped_Days.
3. WHEN Tracker_End_Date is recomputed, THE Daily_Tracker_Calendar SHALL display the updated Tracker_End_Date and SHALL extend the rendered date range per Requirement 3.1, without requiring a page reload.
4. IF the Total_Skipped_Days increment or Tracker_End_Date recompute fails after the Daily_Log status is saved, THEN THE System SHALL roll back the Daily_Log save so that neither the status change nor the Total_Skipped_Days increment is persisted, and SHALL display an error message to the customer.

### Requirement 9: Tracker End Date Reduction on Un-Skip

**User Story:** As a KIT customer, I want my tracker's end date to shrink back if I change a previously skipped day to taken, so that the end date always reflects my actual skip count.

#### Acceptance Criteria

1. WHEN a Daily_Log previously saved with status Food_Skipped is changed and saved with status Food_Taken, THE System SHALL atomically decrement Total_Skipped_Days by one and persist the status change, such that if either operation fails, neither is persisted.
2. WHEN Total_Skipped_Days decrements, THE System SHALL recompute and persist Tracker_End_Date as Received_Date plus (KIT_Duration_Days minus 1) days plus Total_Skipped_Days.
3. IF Total_Skipped_Days is already zero when a Daily_Log previously saved with status Food_Skipped would otherwise cause a decrement, THEN THE System SHALL persist the Food_Taken status change while holding Total_Skipped_Days at zero.
4. THE System SHALL decrement Total_Skipped_Days only when the Daily_Log's immediately preceding saved status was Food_Skipped, and SHALL NOT decrement Total_Skipped_Days when a Daily_Log is created with status Food_Taken for a date with no prior Daily_Log.

### Requirement 10: Admin Read-Only KIT Daily Tracking View

**User Story:** As an admin, I want to view a customer's daily KIT tracking data without editing it, so that I can monitor adherence while preserving the customer as the sole source of daily entries.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display the Admin_KIT_Tab under the existing "KIT" tab of the customer profile, replacing the "Day-wise progress tracking coming soon" placeholder.
2. WHEN the Admin_KIT_Tab is displayed for a KIT_Subscription with a persisted Received_Date, THE Admin_Portal SHALL show the Received_Date, the current Tracker_End_Date, and Total_Skipped_Days.
3. WHEN the Admin_KIT_Tab is displayed for a KIT_Subscription with a persisted Received_Date and at least one saved Daily_Log, THE Admin_Portal SHALL show a day-by-day breakdown, ordered chronologically from earliest to latest date, listing for each logged date the Food_Taken/Food_Skipped status, Physical_Activity_Minutes and Physical_Activity_Name if logged, and Weight_Kg if logged.
4. IF a KIT_Subscription has a persisted Received_Date but no saved Daily_Log, THEN THE Admin_KIT_Tab SHALL show the Received_Date, Tracker_End_Date, and Total_Skipped_Days, together with a message indicating no daily entries have been logged yet, and SHALL NOT display a day-by-day breakdown.
5. IF a KIT_Subscription has no persisted Received_Date, THEN THE Admin_KIT_Tab SHALL display only a message indicating the customer has not yet confirmed package receipt, and SHALL NOT display any other Admin_KIT_Tab content.
6. THE Admin_KIT_Tab SHALL NOT display any control that creates, edits, or deletes a Daily_Log.

### Requirement 11: Data Isolation and Persistence

**User Story:** As a system administrator, I want KIT Tracker data and logic fully isolated from meal subscription data, so that changes to one system cannot affect the other.

#### Acceptance Criteria

1. THE System SHALL persist Daily_Log records in a table dedicated to KIT daily tracking, separate from `subscription_daily_preferences`, `delivery_orders`, `delivery_batches`, and all other Meal_Subscription tables.
2. THE System SHALL NOT execute Meal_Subscription business rules (pause credit recalculation, daily meal preference updates, delivery batch generation, rider assignment) as a result of any Daily_Log record being created, updated, or deleted.
3. THE System SHALL associate each Daily_Log record with exactly one KIT_Subscription and one calendar date.
4. THE System SHALL enforce, at the persistence layer, that at most one Daily_Log record exists per KIT_Subscription per calendar date, including under concurrent write attempts.

### Requirement 12: Feature Scope Restricted to KIT Category

**User Story:** As a system administrator, I want the KIT Tracker to apply only to KIT subscriptions, so that meal and accommodation customers are unaffected.

#### Acceptance Criteria

1. THE KIT_Tracker feature's navigation item display (Requirement 1.1-1.2), Package_Receipt_Screen and Daily_Tracker_Calendar access (Requirement 1.5-1.6), and Received_Date/Daily_Log record creation SHALL apply only to subscriptions where Customer_Category equals "KIT".
2. IF an attempt is made to create a Received_Date or Daily_Log record for a subscription where Customer_Category is "MEAL" or "ACCOMMODATION", THEN THE System SHALL reject the record at the persistence layer, SHALL NOT persist the record, and SHALL return an error indication to the caller, regardless of application-level validation state or concurrent write timing.
3. WHEN a KIT_Subscription's Customer_Category is changed away from "KIT" after Received_Date or Daily_Log data has already been created for it, THE System SHALL retain the existing Received_Date and Daily_Log records without deletion, and SHALL treat the subscription as no longer eligible for KIT_Tracker display or editing per Requirement 1.
