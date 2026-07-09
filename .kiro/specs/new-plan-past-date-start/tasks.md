# Implementation Plan: New Plan Past Date Start

## Overview

This plan implements past-date start date selection in the `AdminAddSubscriptionForm`, allowing admins to create subscriptions with a past start date (up to 30 days back) while preventing overlap with existing subscriptions. The implementation extends the existing form, server action, and utilities with the Past Date Mode toggle, PastDayStatusPopup integration, and 5 PM IST cutoff alert with automation-override acknowledgment.

## Tasks

- [x] 1. Add utility functions and extend types
  - [x] 1.1 Create `getPastDateRangeForAddSub` utility and overlap detection helper
    - Add `getPastDateRangeForAddSub(istToday, previousEndDate)` to `src/lib/onboarding/cutoff.ts`
    - Add `hasOverlap(newStart, newEnd, existingSubscriptions)` pure predicate to a new file `src/lib/subscriptions/overlap.ts`
    - Add `isValidPastStartDate(startDate, istToday, previousEndDate)` server validation helper to `src/lib/subscriptions/overlap.ts`
    - Add `validatePastDayStatuses(entries, startDate, boundaryDate)` validation helper to `src/lib/subscriptions/overlap.ts`
    - _Requirements: 1.3, 1.4, 1.5, 2.1, 2.4, 5.1, 5.4, 5.5_
  - [x] 1.2 Extend `InitialSubscriptionData` type with `previousSubscriptionEndDate`
    - Add `previousSubscriptionEndDate: string | null` to `InitialSubscriptionData` in `AdminAddSubscriptionForm.tsx`
    - Update the parent page that renders this form to fetch and pass the previous subscription's `effective_end_on`
    - _Requirements: 1.3, 1.4, 2.1_

- [x] 2. Implement client-side Past Date Mode in AdminAddSubscriptionForm
  - [x] 2.1 Add Past Date Mode toggle and form schema extensions
    - Add `pastDateEnabled`, `pastDayStatuses`, and `automationOverrideAcknowledged` fields to the Zod `formSchema`
    - Render a "Past date start date" Switch in the start date section, defaulting to off
    - Hide the toggle when `activeSubscription` is not null
    - Disable the toggle with message when `previousSubscriptionEndDate` is yesterday or future
    - _Requirements: 1.1, 1.6, 2.3_
  - [x] 2.2 Implement past-date calendar logic
    - When Past Date Mode is on, compute calendar min/max using `getPastDateRangeForAddSub`
    - When Past Date Mode is off, use `earliestStartDate` from cutoff.ts for future-date min
    - Disable calendar dates that overlap with existing ACTIVE/PENDING subscriptions
    - Bridge between `Date` objects (react-day-picker) and YYYY-MM-DD strings (cutoff.ts) using `format()` and `parseISO()`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.4_
  - [x] 2.3 Integrate PastDayStatusPopup on form submission
    - On submit, if start date is in the past, open `PastDayStatusPopup` with `startDate` and `endDate` (boundary from `pastDayStatusBoundary`)
    - On popup confirm, store entries in form state and proceed with submission
    - On popup cancel, return to form without submitting
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 2.4 Implement 5 PM IST cutoff alert with automation-override acknowledgment
    - Detect when current IST time >= 17:00 AND selected start date is tomorrow
    - Display alert with unchecked acknowledgment checkbox
    - Disable submit button while alert is visible and checkbox is unchecked
    - Enable submit when checkbox is checked; disable when unchecked
    - Hide alert and reset when start date changes away from tomorrow
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 3. Checkpoint - Client-side implementation verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend server action for past-date submissions
  - [x] 4.1 Extend `addSubscription` server action validation and persistence
    - Add `pastDateEnabled`, `pastDayStatuses`, and `skipStartDateCheck` to server-side Zod schemas (`existingPlanSchema` and `customPlanSchema`)
    - When `pastDateEnabled` is true: skip the standard start-date check, validate start date is within allowed range using `isValidPastStartDate`, validate no overlap with ACTIVE/PENDING/EXPIRED subscriptions using `hasOverlap`, validate `pastDayStatuses` completeness using `validatePastDayStatuses`
    - Return descriptive error messages for each validation failure case
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 4.2 Persist past day statuses into `subscription_daily_preferences`
    - When `pastDayStatuses` are provided, override the default daily preference generation for past days
    - For "Delivered" entries: set `meal_category_id` from entry's `mealType`, set `delivery_address_id` from entry's `deliveryAddress`
    - For "Skipped" entries: set `is_paused: true` and `pause_credit_used: true`, increment `pause_credits_used` on subscription
    - _Requirements: 3.6, 5.4_
  - [x] 4.3 Invoke `cascadePendingSubscriptionDates` after past-date subscription creation
    - Import and call `cascadePendingSubscriptionDates` with the new subscription's `effective_end_on` as `baseEndDate`
    - Ensure ACTIVE status assignment when no existing active subscription, PENDING when one exists
    - Verify cascade produces same date-shifting results as future-date subscriptions
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 5. Checkpoint - Server action verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Property-based and unit tests
  - [ ]* 6.1 Write property test for past date range computation
    - **Property 1: Past date range computation**
    - **Validates: Requirements 1.3, 1.4, 1.5, 2.1, 2.2**
  - [ ]* 6.2 Write property test for cutoff-driven earliest future start date
    - **Property 2: Cutoff-driven earliest future start date**
    - **Validates: Requirements 1.2**
  - [ ]* 6.3 Write property test for past day status boundary
    - **Property 3: Past day status boundary**
    - **Validates: Requirements 3.3, 3.4**
  - [ ]* 6.4 Write property test for past day entry validation
    - **Property 4: Past day entry validation**
    - **Validates: Requirements 3.5**
  - [ ]* 6.5 Write property test for automation override submit enablement
    - **Property 5: Automation override controls submit enablement**
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5**
  - [ ]* 6.6 Write property test for overlap detection
    - **Property 6: Overlap detection**
    - **Validates: Requirements 2.4, 2.5, 5.2**
  - [ ]* 6.7 Write property test for server-side past-date acceptance
    - **Property 7: Server-side past-date acceptance**
    - **Validates: Requirements 5.1**
  - [ ]* 6.8 Write property test for past day statuses payload validation
    - **Property 8: Past day statuses payload validation**
    - **Validates: Requirements 5.4, 5.5**
  - [ ]* 6.9 Write property test for subscription status assignment
    - **Property 9: Subscription status assignment**
    - **Validates: Requirements 6.3, 6.4**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- The `PastDayStatusPopup` component is reused as-is — no modifications required
- The `cutoff.ts` utilities (`pastDayStatusBoundary`, `earliestStartDate`, `getPastDateRange`, `PAST_DATE_MAX_DAYS`) are reused directly
- The `cascadePendingSubscriptionDates` function in `manageMealActions.ts` is invoked without modification
- All date logic bridges between `Date` objects (react-day-picker/date-fns) and YYYY-MM-DD strings (cutoff.ts)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9"] }
  ]
}
```
