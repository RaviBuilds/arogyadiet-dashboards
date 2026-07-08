# Implementation Plan: Onboarding Past Date Flexibility

## Overview

This plan implements the past-date onboarding feature for the ArogyaDiet admin Quick Onboarding wizard. The approach builds incrementally: schema and utility functions first, then the service layer logic, followed by UI components, and finally wiring everything together with the server action. Property-based tests validate correctness properties at each layer.

## Tasks

- [x] 1. Schema extension and utility functions
  - [x] 1.1 Extend the onboarding Zod schema with past-date fields
    - Add `pastDateEnabled` (boolean, default false) to the quick onboarding schema in `src/validations/onboardingSchema.ts`
    - Add `automationOverrideAcknowledged` (boolean, default false)
    - Add `pastDayStatuses` array field with per-entry `superRefine` validation (mealType and deliveryAddress required when mealStatus is "Delivered")
    - Add top-level `superRefine` conditional rules: when `pastDateEnabled === true`, require pastDayStatuses length 1–30 and startDate within 30-day past range; when false, enforce existing cutoff rules; when `automationOverrideAcknowledged === true`, allow tomorrow after 5 PM
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 1.2 Create cutoff utility functions for past-date logic
    - Create or extend `src/shared/utils/cutoff.ts` (or existing cutoff utility file)
    - Implement `pastDayStatusBoundary(now: Date): string` — returns today's IST date when hour ≥ 17, yesterday when hour < 17
    - Implement `isPastStartDateValid(startDate: string, now: Date): boolean` — validates startDate < today AND startDate >= today − 30
    - Implement `getPastDateRange(today: string): { start: string; end: string }` — returns [today − 30, today − 1]
    - Export the `PastDayStatus` TypeScript interface from a shared types file (`src/types/onboarding.ts` or similar)
    - _Requirements: 1.2, 3.1, 3.2_

  - [x]* 1.3 Write property tests for past date range computation
    - **Property 1: Past date range computation**
    - Test that for any IST date, `getPastDateRange(today)` returns exactly [today − 30, today − 1]
    - Use fast-check to generate arbitrary dates and verify the range bounds
    - **Validates: Requirements 1.2**

  - [x]* 1.4 Write property tests for past day status boundary
    - **Property 2: Past day status boundary date**
    - Test that for any instant, `pastDayStatusBoundary(now)` returns today when IST hour ≥ 17 and yesterday when IST hour < 17
    - Use fast-check to generate arbitrary Date objects across timezone boundaries
    - **Validates: Requirements 3.1, 3.2**

  - [x]* 1.5 Write property tests for schema conditional validation
    - **Property 15: Schema conditional validation for past-date mode**
    - Test that when `pastDateEnabled === true`, schema requires pastDayStatuses length 1–30 and valid past startDate
    - Test that when `pastDateEnabled === false`, schema does not require pastDayStatuses
    - **Validates: Requirements 8.3, 8.4, 8.5**

  - [x]* 1.6 Write property test for schema tomorrow-after-5PM acknowledgment
    - **Property 16: Schema allows tomorrow after 5PM when acknowledged**
    - Test that validation accepts tomorrow as startDate after 5 PM if and only if `automationOverrideAcknowledged === true`
    - **Validates: Requirements 8.7, 5.1**

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Service layer logic for past-date onboarding
  - [x] 3.1 Implement daily preferences generation for past-date onboarding
    - Extend `OnboardingService` in `src/services/` to accept `pastDayStatuses` parameter
    - Implement logic to generate daily preference records for past days using captured statuses (Delivered → is_paused false, correct meal_category_id and delivery_address_id; Skipped → is_paused true, pause_credit_used true, initial meal preference, primary address)
    - Implement logic to generate daily preference records for future days using initial meal preference and primary address
    - Calculate `skippedCount` from pastDayStatuses entries with mealStatus "Skipped"
    - Adjust `effective_end_on` = original end date + skippedCount days
    - Set `pause_credits_used` = skippedCount on the subscription record
    - Validate total record count = `total_days` + skippedCount before persisting; reject with error if mismatch
    - Ensure all operations execute within a single transaction (existing RPC pattern)
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x]* 3.2 Write property test for daily preferences count invariant
    - **Property 5: Daily preferences count invariant**
    - For any valid inputs with planDuration and skippedCount, verify generated record count equals planDuration + skippedCount
    - Use fast-check to generate arbitrary plan durations and pastDayStatuses arrays
    - **Validates: Requirements 3.3, 4.5, 6.5**

  - [x]* 3.3 Write property test for effective end date extension
    - **Property 6: Effective end date and pause credits extension**
    - For any valid inputs, verify effective_end_on = addDays(starts_on, planDuration - 1 + skippedCount) and pause_credits_used = skippedCount
    - **Validates: Requirements 4.1, 4.3, 4.4**

  - [x]* 3.4 Write property test for past-day records reflecting captured statuses
    - **Property 7: Past-day records faithfully reflect captured statuses**
    - For each past day: Delivered → is_paused false, correct meal/address; Skipped → is_paused true, initial preference, primary address
    - **Validates: Requirements 6.1, 6.3, 6.4, 4.2**

  - [x]* 3.5 Write property test for future-day records using defaults
    - **Property 8: Future-day records use initial preference and primary address**
    - Every future-day daily preference record has is_paused false, initial meal preference, primary address
    - **Validates: Requirements 6.2**

- [x] 4. Server action validation for past-date onboarding
  - [x] 4.1 Extend the onboarding server action with past-date validations
    - Modify `onboardCustomerAction` in `src/actions/admin-actions/onboardingActions.ts`
    - When `pastDateEnabled` is true, bypass existing `isStartDateAllowed()` check
    - Validate: start date within 30-day past range, pastDayStatuses array present and non-empty, entry count matches calendar days from startDate to boundary date, each Delivered entry has mealType and deliveryAddress, no duplicate or out-of-range dates
    - Return errors in the existing `OnboardCustomerActionResult` format with per-field error messages keyed by field path
    - Pass validated `pastDayStatuses` to the service layer
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 4.2 Write property tests for server-side validation rejections
    - **Property 9: Server rejects past date when pastDateEnabled is false**
    - **Property 10: Server rejects dates beyond 30-day range**
    - **Property 11: Server rejects missing or empty past day statuses**
    - **Property 12: Server rejects day count mismatch**
    - **Property 13: Server rejects incomplete delivered entries**
    - **Property 14: Server rejects invalid or duplicate dates in past day statuses**
    - Use fast-check to generate invalid payloads and verify rejection
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. UI components for past-date onboarding
  - [x] 6.1 Add the "Past date start date" checkbox to Step 2
    - In the QuickOnboardingForm Step 2 section, add a checkbox controlled by `pastDateEnabled` form field below the start date dropdown
    - When checked: replace date picker options with dates from today − 30 to yesterday (IST), disable today and future dates
    - When unchecked: revert to existing `earliestStartDate()` logic, clear selected startDate, discard pastDayStatuses from form state
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 6.2 Implement the Past Day Status Popup component
    - Create `src/shared/components/admin/customers/PastDayStatusPopup.tsx`
    - Accept props: open, onConfirm, onCancel, startDate, endDate
    - Generate one row per calendar day from startDate to endDate (inclusive)
    - Each row: date label, Meal_Status radio (Delivered/Skipped), Meal_Type select (VEG/EGG/CHICKEN), Delivery_Address select (Primary/Secondary)
    - When Skipped is selected: disable and clear Meal_Type and Delivery_Address for that row
    - Implement "Fill same status for all remaining days" button: copies from most recently completed row to all unfilled rows (mealStatus === null)
    - Confirm button enabled only when all rows have valid mealStatus AND all Delivered rows have mealType + deliveryAddress
    - Dismiss/close discards all entries and calls onCancel
    - Use Shadcn Dialog, ScrollArea for many days
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x]* 6.3 Write property test for entry validity rules
    - **Property 3: Entry validity — delivered days require meal type and address**
    - For any array of PastDayStatusEntry, verify the validation logic: Delivered requires mealType + deliveryAddress; Skipped requires both null
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

  - [x]* 6.4 Write property test for fill operation
    - **Property 4: Fill operation copies to unfilled entries only**
    - For any array where at least one entry is complete, fill copies to entries with mealStatus === null only, leaving filled entries unchanged
    - **Validates: Requirements 2.7**

  - [x] 6.5 Wire Past Day Status Popup into the Quick Onboarding form flow
    - Trigger popup display when admin attempts to advance from Step 2 to Step 3 with a past start date selected
    - Calculate `endDate` using `pastDayStatusBoundary(now)` at popup render time
    - On confirm: store pastDayStatuses in form state, advance to Step 3
    - On cancel: remain on Step 2 without advancing
    - _Requirements: 1.5, 3.1, 3.2_

  - [x] 6.6 Implement Automation Override Acknowledgment on Step 4
    - Add conditional checkbox on Step 4 (Payment & Review) when: IST hour ≥ 17 at Step 2 render time AND selected start date is tomorrow
    - Checkbox text: "I understand automation needs to run again by operation admin. I have received confirmation from process admin to process this onboarding customer."
    - While unchecked: disable Onboard CTA button
    - When checked: enable Onboard CTA (subject to other validations)
    - Store the 5 PM evaluation result in form state (evaluated once at Step 2 render)
    - When start date changed away from tomorrow: hide checkbox, re-enable CTA
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x]* 6.7 Write unit tests for UI component behavior
    - Test: checkbox appears on Step 2 below start date dropdown
    - Test: unchecking past date checkbox clears startDate and pastDayStatuses
    - Test: popup opens when advancing from Step 2 with past date
    - Test: acknowledgment checkbox visibility based on time + start date
    - Test: CTA disabled when acknowledgment unchecked and tomorrow selected post-5PM
    - _Requirements: 1.1, 1.4, 5.2, 5.4, 5.7_

- [x] 7. Integration wiring and final validation
  - [x] 7.1 Connect form submission to server action with past-date payload
    - Ensure QuickOnboardingForm includes `pastDateEnabled`, `pastDayStatuses`, and `automationOverrideAcknowledged` in the submission payload
    - Map form field errors from server response back to inline form display
    - Handle error responses using existing toast/inline error patterns
    - _Requirements: 7.7, 8.1, 8.6_

  - [x]* 7.2 Write integration tests for end-to-end past-date onboarding
    - Test full submission flow: past-date payload → action → service → verify daily preferences generated correctly
    - Test transaction rollback: simulate DB failure, verify no partial state persists
    - Test boundary conditions: exactly 30 days back, exactly 1 day back, all delivered, all skipped, mixed
    - _Requirements: 4.6, 6.7_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `onboard_customer` RPC provides transactional safety — no new DB migrations needed
- All date logic uses IST timezone consistently via existing utility patterns
- The `PastDayStatusPopup` is a new standalone component that can be developed independently

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6"] },
    { "id": 2, "tasks": ["3.1", "4.1", "6.1", "6.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 4, "tasks": ["6.7", "7.1"] },
    { "id": 5, "tasks": ["7.2"] }
  ]
}
```
