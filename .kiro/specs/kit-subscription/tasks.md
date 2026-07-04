# Implementation Plan: KIT Tracker

## Overview

This implementation plan transforms the KIT Tracker design into discrete coding tasks. The feature adds a daily interaction facility for KIT customers — confirming package receipt, logging daily Food_Taken/Food_Skipped status on a calendar view, automatic tracker end-date extension on skips, and a read-only admin view. The implementation is fully isolated from Meal_Subscription data and business rules, using dedicated database tables, triggers, server actions, and UI components.

**Key Implementation Focus**:
- Database schema changes (new columns on `subscriptions`, new `kit_daily_logs` table, triggers for category guard, received-date lock, and skip-count sync)
- RLS policies for `kit_daily_logs`
- Server actions with Zod validation (`confirmReceivedDateAction`, `saveDailyLogAction`, `getKitTrackerStateAction`)
- Customer Portal: sidebar extension, `/kit-tracker` route, PackageReceiptScreen, DailyTrackerCalendar with DayLogDialog
- Admin Portal: AdminKitTrackerView replacing the placeholder in Customer360Dashboard KIT tab

## Tasks

- [x] 1. Create database schema for KIT Tracker
  - [x] 1.1 Add KIT Tracker columns to subscriptions table
    - Write SQL migration script in `scripts/add-kit-tracker-columns-to-subscriptions.sql`
    - Add `kit_received_date DATE` column (nullable)
    - Add `kit_total_skipped_days INTEGER NOT NULL DEFAULT 0` column
    - Add `kit_tracker_end_date DATE` column (nullable)
    - Add CHECK constraint `chk_kit_tracker_fields_kit_only`: non-KIT subscriptions must have all tracker fields null/zero
    - Add column comments explaining trigger-maintained semantics
    - _Requirements: 11.1, 12.1_

  - [x] 1.2 Create kit_daily_logs table
    - Write SQL migration script in `scripts/create-kit-daily-logs-table.sql`
    - Create table with columns: id (UUID PK), subscription_id (UUID FK → subscriptions), log_date (DATE), status (TEXT with CHECK IN ('FOOD_TAKEN', 'FOOD_SKIPPED')), physical_activity_minutes (INTEGER, nullable, CHECK 0–1440), physical_activity_name (TEXT, nullable, CHECK length ≤ 100), weight_kg (NUMERIC(5,2), nullable, CHECK 0–500), created_at, updated_at
    - Add UNIQUE constraint on `(subscription_id, log_date)` for one-log-per-day enforcement
    - Add CHECK constraint `chk_skipped_has_no_optional_fields`: Food_Skipped rows must have all optional fields NULL
    - Create index `idx_kit_daily_logs_subscription` on subscription_id
    - Create index `idx_kit_daily_logs_subscription_date` on (subscription_id, log_date)
    - _Requirements: 11.1, 11.3, 11.4, 6.1, 6.2_

  - [x] 1.3 Create category guard triggers
    - Write SQL migration script in `scripts/create-kit-tracker-category-guard-triggers.sql`
    - Create function `kit_tracker_category_guard()`: BEFORE INSERT OR UPDATE on kit_daily_logs, SELECT customer_category FOR UPDATE from subscriptions, raise exception if not 'KIT'
    - Create trigger `trg_kit_daily_logs_category_guard` on kit_daily_logs
    - Create function `kit_received_date_category_guard()`: BEFORE INSERT OR UPDATE OF kit_received_date on subscriptions, raise exception if kit_received_date IS NOT NULL and customer_category != 'KIT'
    - Create trigger `trg_subscriptions_kit_received_date_guard` on subscriptions
    - _Requirements: 12.1, 12.2_

  - [x] 1.4 Create received_date lock trigger
    - Write SQL migration script in `scripts/create-kit-received-date-lock-trigger.sql`
    - Create function `kit_received_date_lock_guard()`: BEFORE UPDATE OF kit_received_date on subscriptions, if old value is not null and new value differs, check if any kit_daily_logs exist for that subscription — if yes, raise exception
    - Create trigger `trg_subscriptions_kit_received_date_lock` on subscriptions
    - _Requirements: 2.7, 2.8_

  - [x] 1.5 Create skip-count and tracker end-date sync trigger
    - Write SQL migration script in `scripts/create-kit-tracker-sync-trigger.sql`
    - Create function `kit_tracker_sync_skip_count()`: AFTER INSERT OR UPDATE OR DELETE on kit_daily_logs, COUNT Food_Skipped rows for the subscription, SELECT kit_received_date and kit_duration_days FOR UPDATE, UPDATE subscriptions SET kit_total_skipped_days and kit_tracker_end_date (received_date + duration - 1 + skipped_count)
    - Create trigger `trg_kit_daily_logs_sync` on kit_daily_logs FOR EACH ROW
    - _Requirements: 3.2, 8.1, 8.2, 8.4, 9.1, 9.2_

  - [x] 1.6 Create RLS policies for kit_daily_logs
    - Write SQL migration script in `scripts/create-kit-daily-logs-rls-policies.sql`
    - Enable RLS on kit_daily_logs
    - GRANT SELECT, INSERT, UPDATE to authenticated
    - Create SELECT policy: is_global_role() OR subscription belongs to authenticated user (join through subscriptions → customer_profiles → users)
    - Create INSERT policy: same check via WITH CHECK
    - Create UPDATE policy: same check via USING
    - No DELETE policy (logs are never deleted through the app)
    - _Requirements: 11.1, 12.1_

- [x] 2. Checkpoint - Verify database schema
  - Run all migration scripts and verify tables, constraints, triggers, and RLS policies are created successfully
  - Test category guard by attempting an insert for a MEAL subscription (should fail)
  - Test uniqueness constraint with duplicate (subscription_id, log_date) inserts
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement server actions and validation schemas
  - [x] 3.1 Create Zod validation schema for KIT Tracker
    - Create `src/validations/kitTrackerSchema.ts`
    - Define `dailyLogSchema` as a discriminated union on "status":
      - FOOD_TAKEN branch: optional activityMinutes (int, 0–1440), optional activityName (string max 100), optional weightKg (number, 0–500, max 2 decimal places via refine)
      - FOOD_SKIPPED branch: no optional fields
    - Define `receivedDateSchema`: date string (yyyy-MM-dd format)
    - Export schemas for use in server actions
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 6.1_

  - [x] 3.2 Implement confirmReceivedDateAction
    - Create `src/actions/kitTrackerActions.ts`
    - Implement `confirmReceivedDateAction(subscriptionId: string, receivedDate: string)`: validate date format with Zod, fetch subscription to verify customer_category = 'KIT', validate receivedDate is within [subscription start_date, today] inclusive, UPDATE subscriptions SET kit_received_date, compute and SET kit_tracker_end_date = receivedDate + (kit_duration_days - 1) + kit_total_skipped_days
    - Return `{ success: true }` or `{ success: false; error: string }`
    - Handle trigger errors (category guard, lock guard) gracefully with user-friendly messages
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 3.3 Implement saveDailyLogAction
    - Add to `src/actions/kitTrackerActions.ts`
    - Implement `saveDailyLogAction(subscriptionId: string, logDate: string, input: DailyLogInput)`: validate with dailyLogSchema, fetch subscription to verify category = 'KIT' and kit_received_date is set, validate logDate is within [kit_received_date, today] (server-clock, never trust client), for FOOD_SKIPPED force optional fields to null, INSERT ... ON CONFLICT (subscription_id, log_date) DO UPDATE SET status and optional fields
    - Return `{ success: true; totalSkippedDays: number; trackerEndDate: string }` or `{ success: false; error: string }`
    - Re-fetch updated kit_total_skipped_days and kit_tracker_end_date after the write (trigger maintains them)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.7, 6.2, 6.4, 8.1, 8.2, 8.4, 9.1, 9.2_

  - [x] 3.4 Implement getKitTrackerStateAction
    - Add to `src/actions/kitTrackerActions.ts`
    - Implement `getKitTrackerStateAction(subscriptionId: string)`: fetch kit_received_date, kit_tracker_end_date, kit_total_skipped_days from subscriptions, fetch all kit_daily_logs rows for the subscription ordered by log_date ASC
    - Return `{ receivedDate, trackerEndDate, totalSkippedDays, dailyLogs }`
    - _Requirements: 3.1, 10.2, 10.3_

  - [ ]* 3.5 Write unit tests for Zod validation schema
    - Create `src/validations/__tests__/kitTrackerSchema.test.ts`
    - Test activityMinutes boundary values (0, 1440, -1, 1441, 12.5 decimal)
    - Test weightKg boundary values (0, 500, 500.01, 3 decimal places)
    - Test activityName at 100 and 101 characters
    - Test FOOD_SKIPPED rejects when optional fields are provided
    - Test FOOD_TAKEN accepts all-optional-fields-omitted
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 6.1_

- [x] 4. Checkpoint - Verify server actions
  - Test confirmReceivedDateAction with valid and invalid dates
  - Test saveDailyLogAction with Food_Taken and Food_Skipped
  - Verify trigger fires correctly (kit_total_skipped_days updates, kit_tracker_end_date recomputes)
  - Test category guard rejection for non-KIT subscriptions
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Build Customer Portal — sidebar extension and route
  - [x] 5.1 Add KIT Tracker navigation item to customer sidebar
    - Modify `src/shared/components/layout/customer-sidebar.tsx`
    - Add a "KIT Tracker" nav item with CalendarCheck icon to KIT-only nav group
    - Route to `/kit-tracker`
    - Render only when `isKit` is true (the component already computes and filters by `isKit`)
    - _Requirements: 1.1, 1.2_

  - [x] 5.2 Create KIT Tracker route page (Server Component)
    - Create `src/app/customer/(main)/kit-tracker/page.tsx`
    - Resolve the customer's KIT subscription (active/pending subscription where customer_category = 'KIT')
    - If customer's active subscription category is not KIT: redirect to `/dashboard` with query flag for toast "KIT Tracker is unavailable for your account"
    - If no KIT subscription row exists: render inline "No KIT subscription found" message
    - If kit_received_date IS NULL: render `<PackageReceiptScreen>` with subscription data
    - If kit_received_date IS NOT NULL: fetch all kit_daily_logs, render `<DailyTrackerCalendar>` with subscription data, daily logs, and server-clock today date
    - Compute today's date server-side (never trust client)
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

- [x] 6. Build Customer Portal — PackageReceiptScreen
  - [x] 6.1 Implement PackageReceiptScreen component
    - Create `src/shared/components/customer/kit-tracker/PackageReceiptScreen.tsx` (Client Component)
    - Props: subscriptionId, subscriptionStartDate, initialReceivedDate (nullable for re-confirm path), hasAnyDailyLog (boolean), todayServerDate
    - Date picker defaulting to todayServerDate prop (not browser Date.now())
    - Client-side validation: reject dates after today or before subscriptionStartDate, keep previously valid value, show inline error
    - "Mark KIT Received" button calls confirmReceivedDateAction
    - On success: use router.refresh() to transition to Daily_Tracker_Calendar
    - On failure: show error message, preserve selected date for retry
    - If hasAnyDailyLog is true, component should not be rendered (enforced by route, but add guard)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9_

- [x] 7. Build Customer Portal — DailyTrackerCalendar and DayLogDialog
  - [x] 7.1 Implement DailyTrackerCalendar component
    - Create `src/shared/components/customer/kit-tracker/DailyTrackerClient.tsx` (Client Component)
    - Props: subscriptionId, receivedDate, trackerEndDate, totalSkippedDays, dailyLogsByDate (map of yyyy-MM-dd → log), todayServerDate
    - Render fixed header with Total_Skipped_Days count and current Tracker_End_Date
    - Render date range from receivedDate through trackerEndDate as one card per calendar month
    - Each month card has weekday header row (Su Mo Tu We Th Fr Sa) and 7-column grid of day cells
    - Day cells show: date number, status icon (distinct icon + background per Food_Taken/Food_Skipped), activity-minutes badge if logged, weight badge if logged
    - Days without a log show date number only (no status icon)
    - Days within [receivedDate, todayServerDate] are clickable (open DayLogDialog); days outside are locked
    - Physical_Activity_Name is NOT shown on day cells
    - Update totalSkippedDays and trackerEndDate optimistically from server action response (no page reload)
    - This component must NOT import from MealPlannerClient or any meal subscription components
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.3, 9.2_

  - [x] 7.2 Implement DayLogDialog component
    - Create `src/shared/components/customer/kit-tracker/DayLogDialog.tsx` (Client Component)
    - Props: subscriptionId, logDate, existingLog (nullable), onSaved callback
    - Status toggle: Food_Taken / Food_Skipped (required, exactly one)
    - When Food_Taken selected: show optional fields — Physical_Activity_Minutes (integer input, 0–1440), Physical_Activity_Name (text input, max 100 chars), Weight_Kg (number input, 0–500, up to 2 decimals)
    - When Food_Skipped selected: unmount (not disable) the three optional fields entirely
    - Use React Hook Form with kitTrackerSchema Zod validation
    - Submit via saveDailyLogAction; on success, call onSaved with returned totalSkippedDays/trackerEndDate
    - On validation error: show inline field-level errors, preserve user input
    - _Requirements: 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.3, 6.4_

- [x] 8. Checkpoint - Test Customer Portal KIT Tracker
  - Test KIT Tracker nav item visibility for KIT vs non-KIT customers
  - Test direct URL access by non-KIT customer redirects with message
  - Test PackageReceiptScreen date validation (future dates rejected, pre-start dates rejected)
  - Test calendar renders correctly after receipt confirmation
  - Test logging Food_Taken and Food_Skipped via DayLogDialog
  - Test skip extends end date, un-skip shrinks it back
  - Verify Food_Skipped hides optional fields and clears previously saved values
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Build Admin Portal — AdminKitTrackerView
  - [x] 9.1 Implement AdminKitTrackerView component
    - Create `src/shared/components/admin/customers/kit-tracker/AdminKitTrackerView.tsx`
    - Props: kitSubscription (with kit_received_date, kit_tracker_end_date, kit_total_skipped_days, kit_duration_days), dailyLogs (array of KitDailyLog)
    - Three rendering states:
      - No kit_received_date → single message: "Customer has not yet confirmed package receipt."
      - kit_received_date present, no logs → summary cards (Received_Date, Tracker_End_Date, Total_Skipped_Days) + "No daily entries have been logged yet."
      - kit_received_date present with ≥1 log → summary cards + chronological (ascending date) table listing: date, status, activity minutes + name if logged, weight if logged
    - Strictly read-only: NO create/edit/delete controls anywhere
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 9.2 Wire AdminKitTrackerView into Customer360Dashboard KIT tab
    - Modify `src/shared/components/admin/customers/Customer360Dashboard.tsx` (or the KIT tab section)
    - Remove the "Day-wise progress tracking coming soon" placeholder card
    - Fetch kit_daily_logs for the customer's KIT subscription (alongside existing kitSubscription fetch)
    - Render `<AdminKitTrackerView>` with fetched data
    - _Requirements: 10.1_

- [x] 10. Checkpoint - Test Admin Portal KIT Tracker view
  - Verify KIT tab placeholder is removed
  - Test "not confirmed" message when no kit_received_date
  - Test summary + "no entries" when received but no logs
  - Test full summary + day-by-day breakdown with logged data
  - Verify no edit/create/delete controls are present
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Property-based tests for core correctness properties
  - [ ]* 11.1 Write property test for KIT-Only Access Control
    - **Property 1: KIT-Only Access Control**
    - **Validates: Requirements 1.1, 1.2, 1.3, 12.1**
    - Generate random customer_category values (MEAL, KIT, ACCOMMODATION)
    - Verify nav visibility and route rendering match `=== 'KIT'` exactly
    - Use fast-check, minimum 100 iterations

  - [ ]* 11.2 Write property test for Received_Date Range Validation
    - **Property 3: Received_Date Range Validation**
    - **Validates: Requirements 2.3, 2.4**
    - Generate random (subscriptionStart, today, candidate) date triples
    - Verify acceptance iff candidate is within [subscriptionStart, today] inclusive
    - Use fast-check, minimum 100 iterations

  - [ ]* 11.3 Write property test for Received_Date Editability Lock
    - **Property 4: Received_Date Editability Lock**
    - **Validates: Requirements 2.7, 2.8**
    - Generate random subscriptions with 0 or more daily log rows
    - Verify edit succeeds iff zero logs exist for that subscription
    - Use fast-check, minimum 100 iterations

  - [ ]* 11.4 Write property test for Tracker_End_Date Computation
    - **Property 7: Tracker_End_Date Computation Correctness Under Skip/Un-Skip Sequences**
    - **Validates: Requirements 3.2, 7.6, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4**
    - Generate random receivedDate, durationDays, and sequences of daily log operations
    - After each operation: assert totalSkippedDays = count of FOOD_SKIPPED rows, totalSkippedDays >= 0, trackerEndDate = receivedDate + (duration - 1) + totalSkippedDays
    - Use fast-check, minimum 100 iterations

  - [ ]* 11.5 Write property test for Editable_Window Boundary Enforcement
    - **Property 10: Editable_Window Boundary Enforcement**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Generate random (receivedDate, today, candidateDate) triples
    - Verify write succeeds only if candidateDate is within [receivedDate, today] inclusive
    - Use fast-check, minimum 100 iterations

  - [ ]* 11.6 Write property test for Optional Field Validation and Persistence
    - **Property 12: Optional Field Validation and Persistence for Food_Taken**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**
    - Generate random combinations of valid/invalid/omitted values for activityMinutes, activityName, weightKg
    - Verify per-field accept/reject and round-trip persistence with no defaults substituted
    - Use fast-check, minimum 100 iterations

  - [ ]* 11.7 Write property test for Food_Skipped Field Clearing
    - **Property 13: Food_Skipped Clears and Excludes Optional Fields**
    - **Validates: Requirements 6.1, 6.2, 6.4**
    - Generate random optional-field payloads submitted with FOOD_SKIPPED, and Food_Taken→Food_Skipped transitions
    - Verify all three optional fields are null/empty afterward
    - Use fast-check, minimum 100 iterations

  - [ ]* 11.8 Write property test for Category-Scoping Rejection
    - **Property 16: Category-Scoping Rejection for Non-KIT Subscriptions**
    - **Validates: Requirements 12.2**
    - Generate random non-KIT subscriptions, attempt kit_received_date and kit_daily_logs writes
    - Verify rejection in every case regardless of application-level validation state
    - Use fast-check, minimum 100 iterations

- [x] 12. Final checkpoint - Ensure all tests pass
  - Run all property-based tests (minimum 100 iterations each)
  - Verify complete flow: receipt confirmation → daily logging → skip extension → un-skip reduction
  - Verify admin view renders correctly in all states
  - Verify business rule isolation (no meal subscription artifacts affected)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation maintains strict separation between KIT Tracker and Meal_Subscription business logic
- All database operations use Supabase client with appropriate RLS policies
- Server Components are used by default; Client Components only for interactive forms/calendar
- Zod validation schemas provide runtime type safety for all inputs
- The DailyTrackerCalendar reuses only the visual pattern (month-grid layout) of MealPlannerClient — no shared imports or business logic
- Triggers handle atomicity (skip-count sync, category guard, received-date lock) — no application-level compensating logic needed
- The `todayServerDate` prop is always computed server-side and passed down; client-side `Date.now()` is never trusted for editable-window enforcement

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["3.5", "5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["9.2"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8"] }
  ]
}
```
