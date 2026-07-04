# Implementation Plan: Vercel Cron Automations

## Overview

This implementation registers three existing automation scripts as Vercel Cron Jobs by updating `vercel.json`, hardens the authentication by removing the default secret fallback from all cron routes, and adds admin notification to the dispatch route. The primary change is configuration — the route handlers already exist with full automation logic, logging, and notifications (except dispatch).

## Tasks

- [x] 1. Harden cron route authentication (remove default secret fallback)
  - [x] 1.1 Remove default secret fallback from `/api/cron/generate-orders/route.ts`
    - Replace `process.env.CRON_SECRET || "arogya-demo-123"` with `process.env.CRON_SECRET`
    - Add early return with 401 if `expectedSecret` is falsy (env var unset)
    - Ensure the check rejects when secret param is missing OR doesn't match
    - _Requirements: 4.1, 4.4_

  - [x] 1.2 Remove default secret fallback from `/api/cron/link-products/route.ts`
    - Replace `process.env.CRON_SECRET || "arogya-demo-123"` with `process.env.CRON_SECRET`
    - Add early return with 401 if `expectedSecret` is falsy (env var unset)
    - _Requirements: 4.1, 4.4_

  - [x] 1.3 Remove default secret fallback from `/api/cron/dispatch/route.ts`
    - Replace `process.env.CRON_SECRET || "arogya-demo-123"` with `process.env.CRON_SECRET`
    - Add early return with 401 if `expectedSecret` is falsy (env var unset)
    - _Requirements: 4.1, 4.4_

  - [x] 1.4 Remove default secret fallback from `/api/cron/activate-subscriptions/route.ts`
    - Replace `process.env.CRON_SECRET || "arogya-demo-123"` with `process.env.CRON_SECRET`
    - Add early return with 401 if `expectedSecret` is falsy (env var unset)
    - Keep all other logic unchanged
    - _Requirements: 4.1, 4.4_

- [x] 2. Add admin notification to dispatch route
  - [x] 2.1 Add `notifyAdmins` call to `/api/cron/dispatch/route.ts` after successful dispatch
    - Import `notifyAdmins` and `buildPushPayload` from `@/lib/notifications`
    - After `executeAutomatedDispatch` returns successfully (no error), call `notifyAdmins` with dispatch statistics (batch count, orders assigned)
    - Wrap notification in try/catch so notification failure does not affect the 200 response
    - Follow the same pattern used in `generate-orders/route.ts` and `link-products/route.ts`
    - _Requirements: 3.5_

  - [ ]* 2.2 Write unit test for dispatch route notification behavior
    - Verify `notifyAdmins` is called after successful dispatch
    - Verify notification failure does not change the HTTP 200 response
    - Verify notification is NOT sent when dispatch returns an error
    - _Requirements: 3.5_

- [x] 3. Checkpoint - Verify auth hardening and notification changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update Vercel cron configuration
  - [x] 4.1 Add three new cron entries to `vercel.json`
    - Add entry for `generate-orders` with path `/api/cron/generate-orders?secret=<CRON_SECRET>` and schedule `45 11 * * *`
    - Add entry for `link-products` with path `/api/cron/link-products?secret=<CRON_SECRET>` and schedule `35 18 * * *`
    - Add entry for `dispatch` with path `/api/cron/dispatch?secret=<CRON_SECRET>` and schedule `40 18 * * *`
    - Retain the existing `activate-subscriptions` entry unchanged
    - Final `crons` array must contain exactly 4 entries
    - Use the actual CRON_SECRET value from environment in the path query parameter (same pattern as existing activate-subscriptions entry)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 4.2 Write unit test to validate vercel.json structure
    - Parse `vercel.json` and assert `crons` array has exactly 4 entries
    - Assert each entry has `path` (string) and `schedule` (string) keys
    - Assert schedules match expected UTC cron expressions: `30 8 * * *`, `45 11 * * *`, `35 18 * * *`, `40 18 * * *`
    - Assert paths contain correct route prefixes and `?secret=` query parameter
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 5. Checkpoint - Verify complete implementation
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 6. Property-based tests for cron authentication
  - [ ]* 6.1 Write property test: Authentication rejection for invalid secrets
    - **Property 1: Authentication rejection for invalid secrets**
    - **Validates: Requirements 1.2, 4.1, 4.4**
    - Use `fast-check` to generate arbitrary strings (including empty, unicode, whitespace)
    - For each generated string that does NOT equal `process.env.CRON_SECRET`, verify all 4 cron route handlers return HTTP 401
    - Verify no database side-effects occur on rejection

  - [ ]* 6.2 Write property test: Authentication acceptance for valid secret
    - **Property 2: Authentication acceptance for valid secret**
    - **Validates: Requirements 4.2**
    - Use `fast-check` to generate random CRON_SECRET values, set env var accordingly
    - Call each route with the matching secret, verify non-401 response

  - [ ]* 6.3 Write property test: Automation log run-count consistency
    - **Property 3: Automation log run-count consistency**
    - **Validates: Requirements 7.1, 7.2**
    - Use `fast-check` to generate random execution counts (1-20)
    - For each count N, invoke the automation N times, verify `run_count` equals N in `automation_logs`

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The primary deliverable is task 4.1 (vercel.json update) — tasks 1.x and 2.1 are security/notification fixes identified in the design
- Each task references specific requirements for traceability
- The existing manual triggers (server actions on Operations page) are NOT modified
- The actual CRON_SECRET value must be sourced from the Vercel project environment variables
- Property tests validate universal correctness properties from the design document
- All routes already implement automation logging — no logging changes needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "4.2"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3"] }
  ]
}
```
