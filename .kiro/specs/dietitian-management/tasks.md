# Implementation Plan: Dietitian Management

## Overview

Implementation follows the layering declared in the design: additive SQL migration first, then pure modules in `src/lib/dietitian/*` and the extended access model in `src/lib/auth/*`, then Zod schemas, repositories, services, Server Actions, shared components in `src/shared/components/dietitian/`, and finally the portal surfaces (master, admin, franchise). Every layer is wired into the layer above it before the next epic starts, so no module is left orphaned.

Language and stack: TypeScript on Next.js 16 App Router with Supabase, Zod, Shadcn UI, Recharts and `@react-pdf/renderer`. Tests use `vitest` with `fast-check` (both already installed). The franchise portal lives at `src/app/franchise` and is served on the `franchies` subdomain.

## Tasks

- [x] 1. Database and type foundation

  - [x] 1.1 Write the additive, idempotent migration script
    - Create `scripts/create-dietitian-management.sql` exactly as specified in the design Data Models section: extend the `users_admin_access_level_check` constraint with `dietitian`, add `users.dietitian_clinic_id`, add `users_dietitian_mobile_check`, add the partial unique index `users_one_active_dietitian_per_franchise`, add `customer_profiles.dietitian_id` with `ON DELETE SET NULL`, create `health_logs` with the `(customer_profile_id, log_date) WHERE author_type='DIETITIAN'` unique index, create `health_log_audit_entries` with the append-only trigger, and create every supporting index
    - Use `IF NOT EXISTS` / `DROP … IF EXISTS` + recreate for every statement
    - _Requirements: 1.1, 1.2, 2.7, 2.8, 6.1, 10.5, 15.11, 18.4, 18.7, 26.1, 26.7, 26.8_

  - [x] 1.2 Add the Health_Log read model and RLS policies
    - Append the `v_health_log_timeline` union view over `health_logs`, `admin_health_logs`, `customer_health_logs` and `kit_daily_logs` with the parameter mapping from the design
    - Add `current_dietitian()` and `dietitian_can_read_customer()` security-definer helpers, the additive `SELECT` policy on `customer_profiles`, `health_logs` select/insert/update policies with no delete policy, and `health_log_audit_entries` policies
    - Leave `admin_health_logs`, `customer_health_logs` and `kit_daily_logs` untouched
    - _Requirements: 5.7, 18.4, 25.4, 26.2, 26.3, 26.4_

  - [x] 1.3 Create the TypeScript types
    - Create `src/types/dietitian.ts` with `DietitianAccount`, `ParameterValue`, `HealthLog`, `AuditEntry`, `CustomParameter`, `DietitianActivitySummary` and `CustomerCategory`
    - _Requirements: 6.1, 11.12, 12.2, 15.12, 18.5_

  - [x]* 1.4 Write integration tests for the migration and database constraints
    - Migration runs twice with identical resulting schema and data; legacy log tables unchanged
    - `admin_access_level` constraint and the Dietitian 10-digit mobile constraint accept/reject direct writes; `UPDATE`/`DELETE` on `health_log_audit_entries` raise even on the service-role key
    - _Requirements: 1.2, 1.3, 2.7, 18.7, 26.3, 26.8_

  - [x] 1.5 Write the idempotent Dietitian seed script
    - Create `scripts/seed-dietitians.mjs` creating Avinash / Nandini / Divya / Joshitha with role `ADMIN`, `admin_access_level='dietitian'`, `franchise_id` NULL, `dietitian_clinic_id` NULL, `is_active` true, `force_password_change` true
    - Skip and report any row whose email or mobile already exists
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x]* 1.6 Write property test for the seed routine
    - **Property 37: Seeding skips and reports pre-existing Dietitians**
    - **Validates: Requirements 4.6**

- [x] 2. Pure domain modules in `src/lib/dietitian/`

  - [x]* 2.1 Create the shared property-test arbitraries
    - Create `src/test/dietitian/arbitraries.ts` with IST date strings, Logging_Windows with paused subsets, Customer_Records across the three categories with varied clinic/franchise/link combinations, sparse parameter maps including all-empty, Custom_Parameter lists with case/whitespace-variant duplicate labels, and access configurations across all four levels
    - _Requirements: 11.5, 12.5, 14.3, 17.6_

  - [x] 2.2 Create the user-visible message constants
    - Create `src/lib/dietitian/messages.ts` exporting every pinned string from the design error table plus the `{label} must be between {min} and {max} {unit}` formatter
    - _Requirements: 2.4, 2.5, 2.6, 2.11, 4.4, 5.9, 6.4, 7.2, 7.5, 7.8, 8.3, 11.11, 12.4, 12.5, 13.2, 15.7, 15.8, 15.13, 18.2, 18.3, 18.4, 19.8, 20.7, 22.4, 24.4_

  - [x] 2.3 Implement the Cadence_Engine
    - Create `src/lib/dietitian/cadence.ts` with `CADENCE_INTERVALS`, `cadenceIntervalFor` and `computeCadence(input): CadenceSnapshot`
    - Clamp the window end to `today`, treat a paused date as ineligible, count Eligible_Days strictly after `effectiveLastLogDate`, derive `pendingLogCount = floor(daysNotLogged / cadenceInterval)`, zero everything for a non-`ACTIVE` status, and take `today` as an injected `YYYY-MM-DD` string
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.14_

  - [x]* 2.4 Write property test for the Cadence_Engine against a naive reference model
    - **Property 20: The Cadence_Engine agrees with a naive day-by-day reference model**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.12, 14.13, 19.9**

  - [x]* 2.5 Write property test for pause monotonicity
    - **Property 21: Pausing an Eligible_Day never increases Days_Not_Logged**
    - **Validates: Requirements 14.11**

  - [x] 2.6 Implement the Health_Log field sets
    - Create `src/lib/dietitian/fieldSets.ts` with the 28-entry `HEALTH_LOG_FIELDS` table from the design (key, label, kind, unit, min/max, options, `accommodationOnly`), `ACCOMMODATION_FIELD_SET`, `MEAL_KIT_FIELD_SET` derived by filtering `accommodationOnly`, `fieldSetFor` and `fieldByKey`
    - _Requirements: 11.1, 11.2, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x]* 2.7 Write unit tests for the field-set constants
    - Assert 28 accommodation entries, the 22-entry derivation, and the range/unit metadata of the bounded parameters
    - _Requirements: 11.1, 11.2_

  - [x] 2.8 Implement Custom_Parameter validation and serialization
    - Create `src/lib/dietitian/customParameters.ts` with `MAX_CUSTOM_PARAMETERS`, `validateCustomParameters`, `serializeCustomParameters` and `deserializeCustomParameters`, trimming labels, enforcing lengths and the 20-entry cap, and rejecting empty and case-folded duplicate labels with the pinned messages
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x]* 2.9 Write property test for Custom_Parameter handling
    - **Property 18: Custom_Parameter lists validate and serialize round-trip**
    - **Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.8**

  - [x] 2.10 Implement the Dietitian scope predicate
    - Create `src/lib/dietitian/scope.ts` with `DietitianScope`, `dietitianCanRead` mirroring the RLS predicate exactly, and `applyDietitianScope` for Supabase query builders
    - A core Dietitian with no Clinic degenerates to the `dietitian_id = me` disjunct
    - _Requirements: 4.4, 5.5, 5.6, 5.11, 21.8, 21.11, 22.8_

  - [x]* 2.11 Write property test for the scope predicate
    - **Property 3: Dietitian read scope is sound — no record outside the scope predicate is ever readable**
    - **Validates: Requirements 4.4, 5.5, 5.6, 5.8, 5.9, 5.11, 21.8, 21.11, 22.8, 25.1, 25.2**

  - [x] 2.12 Implement list filters and sorting
    - Create `src/lib/dietitian/listFilters.ts` with `DietitianCustomerRow`, `DietitianFilters`, `applyDietitianFilters` folding predicates by conjunction, and `sortDietitianRows` as a copy-then-sort treating a null `lastDietitianLogDate` as the earliest orderable value in both directions
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [x]* 2.13 Write property test for filter composition
    - **Property 26: Filters compose by conjunction and never grow the result**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.7, 17.8**

  - [x]* 2.14 Write property test for sorting
    - **Property 27: Sorting orders correctly, treats a missing last-log date as earliest, and preserves the multiset**
    - **Validates: Requirements 17.4, 17.5, 17.6, 17.9**

  - [x] 2.15 Implement selectable log dates
    - Create `src/lib/dietitian/logDates.ts` computing the Eligible_Days of the trailing 7 days up to and including the current IST date, reusing the cadence eligibility rule
    - _Requirements: 15.6_

  - [x]* 2.16 Write property test for selectable log dates
    - **Property 24: Selectable log dates are the Eligible_Days of the trailing 7 days**
    - **Validates: Requirements 15.6**

- [x] 3. Access model, guards and portal wiring

  - [x] 3.1 Extend the pure access model
    - In `src/lib/auth/adminAccessCore.ts` add `dietitian` to `ADMIN_ACCESS_LEVELS`, `DIETITIAN_ACCESS_LEVEL`, `DIETITIAN_ALLOWED_PREFIXES`, `isDietitianLevel`, `landingRouteFor`, `PortalBase`, `toCanonicalPath` and `isPortalPathAllowed`, keeping `isAdminPathAllowed` as a thin `/admin` wrapper
    - Preserve the existing coercion of NULL/unknown values to `inventory_operations`, resolve `dietitian` to an empty operations-group map, and leave every existing level's decision table byte-identical
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 5.4, 21.5, 26.5, 26.6_

  - [x]* 3.2 Write property test for Access_Level resolution
    - **Property 1: Access_Level resolution round-trips and defaults safely**
    - **Validates: Requirements 1.1, 1.4, 1.5, 1.6**

  - [x]* 3.3 Write property test for the portal path gate
    - **Property 2: The portal path gate is total, allow-listed for Dietitians, and unchanged for every other level**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 21.5, 21.7, 21.9, 21.10, 26.5, 26.6**

  - [x] 3.4 Add the server-side Dietitian guards
    - In `src/lib/auth/adminAccess.ts` add `DietitianContext`, `guardDietitianPage()` and `checkDietitianScope(customerProfileId)`, returning `Customer is not in your scope` on a scope miss and reusing `dietitianCanRead`
    - _Requirements: 5.3, 5.8, 5.9, 5.10, 16.5_

  - [x] 3.5 Wire the gate into middleware and both portal layouts
    - Apply `isPortalPathAllowed` with the correct portal base in `src/middleware.ts`; in `src/app/admin/(main)/layout.tsx` skip the operations-area redirect for `dietitian` and pass the config to `AdminNavbar`; in `src/app/franchise/(main)/layout.tsx` add the suspended/empty-franchise redirects, the `franchises.owner_user_id` override to `inventory_operations`, the Access_Level gate and the config pass-through to `FranchiseNavbar`
    - Trim both navbars to Customers / Log Customer / Profile for a Dietitian
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 21.5, 21.6, 21.7, 21.9, 21.10_

  - [x]* 3.6 Write property test for franchise access resolution
    - **Property 35: The Franchise_Owner resolves to full access; other franchise users resolve to their stored level**
    - **Validates: Requirements 21.6, 24.3**

- [x] 4. Checkpoint - foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Validation schemas

  - [x] 5.1 Create the Dietitian schemas
    - Create `src/validations/dietitianSchema.ts` with `createDietitianSchema`, `updateDietitianSchema` and `assignDietitianSchema`, reporting an empty mobile as `Mobile number is required for a dietitian` before the 10-digit check
    - _Requirements: 2.4, 2.5, 6.4_

  - [x] 5.2 Create the Health_Log schema factory
    - Create `src/validations/healthLogSchema.ts` with `healthLogSchemaFor(category)` built from `fieldSetFor(category)` so rendering and validation cannot drift, a sparse `parameters` record where an absent key means no value, the Custom_Parameter list, and a 1–2000 character Closing_Comment
    - Generate out-of-range messages from the field table
    - _Requirements: 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 13.2, 13.3_

  - [x]* 5.3 Write property test for parameter range validation
    - **Property 16: Parameter range validation rejects out-of-range values and names the range**
    - **Validates: Requirements 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11**

  - [x]* 5.4 Write property test for the Closing_Comment
    - **Property 19: The Closing_Comment is mandatory and length-bounded**
    - **Validates: Requirements 13.2, 13.3**

- [x] 6. Repositories in `src/repositories/dietitian/`

  - [x] 6.1 Implement `dietitianRepository.ts`
    - List/insert/update Dietitian `users` rows, read and write `dietitian_clinic_id`, list Clinics with the owning Franchise name, count active Dietitians per Franchise, list active Dietitians for a Clinic and clinic-independently
    - _Requirements: 2.3, 3.1, 3.3, 3.4, 3.5, 7.1, 8.2, 9.2, 10.1, 10.3, 20.1, 21.1_

  - [x] 6.2 Implement `assignmentRepository.ts`
    - Read/write `customer_profiles.dietitian_id`, verify a candidate user is a Dietitian, clear links when a Dietitian is deleted
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

  - [x] 6.3 Implement `healthLogRepository.ts`
    - Insert/update `health_logs` with an upsert on the dietitian-log conflict target, read a customer's timeline from `v_health_log_timeline`, read Self_Log adherence rows from `kit_daily_logs`, and read distinct Custom_Parameter labels per customer
    - _Requirements: 11.12, 11.13, 12.7, 12.9, 15.9, 15.11, 16.3, 25.1, 25.2, 26.4_

  - [x] 6.4 Implement `auditRepository.ts`
    - Append-only insert into `health_log_audit_entries` and reverse-chronological read per Customer_Record
    - _Requirements: 18.5, 18.6, 18.8_

  - [x] 6.5 Implement `cadenceRepository.ts`
    - The four batched queries: governing subscription or stay, last dietitian log date per customer, paused dates after a cutoff, self-log dates in window
    - _Requirements: 14.3, 14.4, 14.9, 16.3, 17.1_

- [x] 7. Services

  - [x] 7.1 Implement `DietitianAccountService.ts`
    - Create, edit, deactivate and list Dietitians; derive role and `franchise_id` from the assigned Clinic's `franchise_id`; map `users_mobile_key` and the partial unique index violations to their pinned messages; delete the auth identity on any post-auth failure; write `admin_activity_logs` entries; ban the auth account on deactivation
    - _Requirements: 2.6, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 3.6, 3.7, 3.9, 3.11, 10.1, 10.2, 10.3, 10.4, 21.3, 22.3, 22.7_

  - [x]* 7.2 Write property test for Dietitian field derivation
    - **Property 5: Dietitian account fields are derived from the assigned Clinic**
    - **Validates: Requirements 2.9, 2.10, 3.6, 22.3**

  - [x]* 7.3 Write property test for franchise Dietitian cardinality
    - **Property 6: At most one active Dietitian per Franchise**
    - **Validates: Requirements 2.11, 3.7, 10.1, 10.2, 10.3, 10.4, 10.6**

  - [x]* 7.4 Write property test for creation atomicity
    - **Property 7: Account and onboarding creation are atomic**
    - **Validates: Requirements 2.14, 7.7, 9.4, 22.7**

  - [x] 7.5 Implement `AssignmentService.ts`
    - Read/write the Dietitian_Link with a dietitian-validity check, `reconcileOnClinicChange(profileId, category, newClinicId)` implementing the per-category table, clinic-membership validation on onboarding submissions, retention of links across reassignment and deactivation, and an `admin_activity_logs` entry naming both endpoints
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 7.7, 7.8, 8.4, 8.5, 8.6, 8.8, 8.9, 9.4_

  - [x]* 7.6 Write property test for Dietitian_Link writes
    - **Property 8: Dietitian_Link writes round-trip and are idempotent**
    - **Validates: Requirements 6.2, 6.4, 6.6, 6.7**

  - [x]* 7.7 Write property test for Dietitian lifecycle retention
    - **Property 9: Clinical history and links survive every Dietitian lifecycle change**
    - **Validates: Requirements 3.8, 3.10, 6.5**

  - [x]* 7.8 Write property test for Dietitian_Link audit entries
    - **Property 10: Dietitian_Link audit entries record both endpoints**
    - **Validates: Requirements 6.8**

  - [x]* 7.9 Write property test for clinic-change reconciliation
    - **Property 13: Clinic changes reconcile the Dietitian_Link by Customer_Category**
    - **Validates: Requirements 7.3, 8.4, 8.5, 8.6**

  - [x]* 7.10 Write property test for clinic-scoped Dietitian options
    - **Property 11: Clinic-scoped Dietitian options are complete and exclusive**
    - **Validates: Requirements 7.1, 7.4, 7.8, 8.2, 8.8**

  - [x]* 7.11 Write property test for unscoped option lists
    - **Property 12: Unscoped Dietitian and Clinic option lists are complete and correctly labelled**
    - **Validates: Requirements 2.3, 3.3, 3.4, 3.5, 4.5, 9.2, 9.5, 20.1**

  - [x] 7.12 Implement `HealthLogService.ts`
    - Validate and persist Health_Logs through the category schema; resolve author, author type and IST submission date; enforce future-date, paused-date, one-log-per-day, same-day edit window and authorship rules; reject deletes; persist only Dietitian-entered values; write an audit entry for accepted and rejected attempts and abort the write if the audit insert fails
    - _Requirements: 11.5, 11.12, 11.13, 11.14, 12.2, 13.4, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 15.13, 15.14, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 25.8_

  - [x]* 7.13 Write property test for Health_Log persistence
    - **Property 17: Health_Log persistence round-trips, with units present exactly when values are**
    - **Validates: Requirements 11.12, 11.13, 11.14, 12.2, 13.4, 15.12**

  - [x]* 7.14 Write property test for the Health_Log write gate
    - **Property 22: The Health_Log write gate enforces one log per day, the edit window, authorship and no deletion**
    - **Validates: Requirements 15.7, 15.8, 15.9, 15.10, 15.11, 15.13, 18.1, 18.2, 18.3, 18.4**

  - [x]* 7.15 Write property test for audit-trail accounting
    - **Property 23: The audit trail accounts for every write attempt**
    - **Validates: Requirements 18.5, 18.6, 18.8, 18.9, 18.10**

  - [x] 7.16 Implement `CadenceService.ts`
    - Assemble cadence inputs with the four batched repository queries, inject `getISTDateString()` as `today`, delegate to `computeCadence`, and return `CadenceSnapshot[]` plus the Self_Log adherence counts used by the list, report card and both activity reports
    - Treat a missing governing subscription or stay as non-`ACTIVE` rather than throwing
    - _Requirements: 14.7, 14.9, 16.3, 16.4, 17.1, 20.8, 24.5_

  - [x] 7.17 Implement `DietitianReportService.ts` and the PDF template
    - Assemble the parameter table, Weight/BP/Fasting Sugar trend series, adherence summary and Closing_Comment history; render `DietitianReportTemplate.tsx` with `@react-pdf/renderer` under a 30-second timeout; return the `No health logs recorded yet` outcome with export disabled when no Health_Log exists
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8_

- [x] 8. Checkpoint - domain and services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Server Actions

  - [x] 9.1 Implement `src/actions/master-actions/dietitianActions.ts`
    - `listDietitians`, `listClinicsForDietitianAssignment`, `createDietitian`, `updateDietitian`, `toggleDietitianActive`
    - _Requirements: 2.3, 2.13, 3.1, 3.5, 3.6, 3.7, 3.9_

  - [x] 9.2 Implement `src/actions/master-actions/dietitianActivityActions.ts`
    - `listActiveDietitians`, `getDietitianActivityReport(dietitianUserId)` computing every metric through `CadenceService`, `listHealthLogAuditEntries(customerProfileId)` in reverse chronological order
    - _Requirements: 18.8, 20.1, 20.2, 20.3, 20.4, 20.5, 20.7, 20.8_

  - [x] 9.3 Implement `src/actions/master-actions/franchiseUserActions.ts`
    - `listFranchiseUsers(franchiseId)`, `createFranchiseUser`, `createFranchiseDietitian` deriving role `FRANCHISE_ADMIN`, the tenant and the Franchise Clinic link
    - _Requirements: 21.1, 21.2, 21.3, 22.2, 22.3, 22.7_

  - [x] 9.4 Implement `src/actions/dietitian-actions/dietitianCustomerActions.ts`
    - `listDietitianCustomers(filters, sort)` composing scope, cadence, pure filters and pure sort; `getDietitianCustomerDetail(id)`; `getCustomParameterSuggestions(id)` — all self-gating via `checkDietitianScope`
    - _Requirements: 4.4, 5.8, 5.9, 12.9, 15.3, 15.4, 16.2, 16.6, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 9.5 Implement `src/actions/dietitian-actions/healthLogActions.ts`
    - `submitHealthLog(input)`, `getHealthLogTimeline(customerProfileId)`, `getSelfLogForDate(customerProfileId, date)`; no write path to Self_Logs
    - _Requirements: 5.8, 5.9, 15.9, 15.12, 25.1, 25.2, 25.3, 25.4, 25.6_

  - [x] 9.6 Implement `src/actions/dietitian-actions/reportCardActions.ts`
    - `getReportCard(customerProfileId)` and `exportReportCardPdf(customerProfileId)`, restricted to `KIT` and `ACCOMMODATION`
    - _Requirements: 19.1, 19.6, 19.7, 19.8_

  - [x] 9.7 Implement `src/actions/admin-actions/dietitianAssignmentActions.ts`
    - `assignCustomerDietitian(customerProfileId, dietitianUserId | null)` and `listDietitiansForClinic(clinicId)` gated by `checkGroupManage("customers")`; invoke `AssignmentService.reconcileOnClinicChange` from the existing `adminAssignCustomerClinic` action
    - _Requirements: 6.4, 6.8, 8.2, 8.4, 8.5, 8.6, 8.9, 9.5_

  - [x]* 9.8 Write property test for operational write denial
    - **Property 4: Every operational write is denied to a Dietitian**
    - **Validates: Requirements 5.10, 16.5, 21.4, 25.4**

  - [x]* 9.9 Write property test for the Dietitian customer list
    - **Property 25: The Dietitian customer list shows exactly the in-scope rows with their cadence values, and search matches any of three fields**
    - **Validates: Requirements 15.3, 15.4, 16.6**

  - [x]* 9.10 Write property test for the activity report aggregation
    - **Property 33: The Dietitian_Activity_Report aggregates its own per-customer table consistently, in both portals**
    - **Validates: Requirements 20.2, 20.3, 20.4, 20.5, 20.9, 20.10, 24.2, 24.6**

- [x] 10. Shared Dietitian components in `src/shared/components/dietitian/`

  - [x] 10.1 Build `HealthLogForm.tsx` and `CustomParameterEditor.tsx`
    - Render `fieldSetFor(category)` by kind, the Custom_Parameter editor with add/remove rows and label suggestions, and the Closing_Comment as the final field; default the log date to the current IST date and restrict the picker to selectable dates; submit `submitHealthLog` and show the success confirmation
    - _Requirements: 11.3, 11.4, 12.1, 12.9, 13.1, 15.5, 15.6, 15.15_

  - [x]* 10.2 Write property test for the rendered field set
    - **Property 15: The rendered field set matches the Customer_Category**
    - **Validates: Requirements 11.3, 11.4, 13.1**

  - [x] 10.3 Build `SelfLogReferencePanel.tsx`
    - Display the selected date's Self_Log values as read-only reference text beside the form, never pre-filling any form field
    - _Requirements: 25.6, 25.7_

  - [x]* 10.4 Write property test for Self_Log isolation
    - **Property 31: Self_Logs are reference-only and never leak into a Dietitian_Log**
    - **Validates: Requirements 25.6, 25.7, 25.8**

  - [x] 10.5 Build `LogCustomerList.tsx`
    - Searchable (name, mobile, customer code), filterable (missing Self_Log, pending only, minimum days) and sortable list with the cadence columns and the assigned Dietitian name; render the `No clinic assigned. Contact the master admin.` notice for an unlinked Dietitian
    - _Requirements: 4.4, 15.3, 15.4, 16.6, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [x] 10.6 Build `HealthLogTimeline.tsx` and `SelfLogAdherencePanel.tsx`
    - Single date-ordered timeline labelling author type, each Closing_Comment with author name and submission timestamp, every Custom_Parameter displayed; adherence panel with the Self_Log list, Skipped_Self_Log count, missing-date count and Paused_Days_Count, all zeroed for `MEAL` and `ACCOMMODATION`
    - _Requirements: 12.7, 13.5, 16.2, 16.3, 16.4, 25.3_

  - [x]* 10.7 Write property test for the Health_Log timeline
    - **Property 30: The Health_Log timeline contains every log exactly once, date-ordered and author-labelled**
    - **Validates: Requirements 12.7, 13.5, 25.3, 26.4**

  - [x] 10.8 Build `DietitianActivityReport.tsx`
    - Pending count, Max_Days_Not_Logged, missing-Self_Log count, the seven-column per-customer table, Report_Card navigation and the empty-state messages
    - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 24.4_

  - [x] 10.9 Build `ReportCardView.tsx`
    - Date-ordered parameter table, Recharts Weight/BP/Fasting Sugar trends, adherence summary, reverse-chronological Closing_Comment history with author names, and the PDF export button disabled when no Health_Log exists
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.8_

  - [x]* 10.10 Write property test for the Report_Card
    - **Property 32: The Report_Card contains every recorded value, its trends, adherence numbers and comment history**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5**

- [x] 11. Master Portal surfaces

  - [x] 11.1 Extend `UserManagement.tsx`
    - Add the `Dietitian` Access Level option with the conditional Mobile input and Assign Clinic dropdown, a Dietitians section separate from Admin Users showing name/email/mobile/clinic/franchise/status/created date with `Unassigned` for an empty link, an editable Clinic dropdown in the edit dialog, and the unassigned-clinic warning banner
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 4.5_

  - [x]* 11.2 Write property test for the Dietitians/Admin Users partition
    - **Property 14: Dietitians are partitioned out of the Admin Users list**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 11.3 Extend the master Edit Franchise workspace
    - Add the Franchise Users section, the Create Franchise User action capturing name/email/mobile/password/Access_Level, and the Create Dietitian action showing the Franchise Clinic read-only, disabled with `Wire a clinic to this franchise first` when no Clinic exists and replaced by Edit Dietitian when an active Dietitian exists
    - _Requirements: 21.1, 21.2, 22.1, 22.2, 22.4, 22.5, 22.6_

  - [x]* 11.4 Write property test for franchise user provisioning
    - **Property 34: Franchise user provisioning derives role and tenant, and the Dietitian action reflects franchise state**
    - **Validates: Requirements 21.1, 21.3, 22.5, 22.6**

  - [x] 11.5 Add the master dashboard activity report and audit viewer
    - Dietitian dropdown labelled with the assigned Clinic name feeding `DietitianActivityReport`, and the Log_Audit_Trail viewer for a selected Customer_Record showing each entry's outcome
    - _Requirements: 18.8, 20.1, 20.6, 20.7_

- [x] 12. Admin Portal surfaces

  - [x] 12.1 Add the Dietitian pages
    - Create `src/app/admin/(main)/log-customer/page.tsx` (guard then `LogCustomerList`) and `src/app/admin/(main)/customers/[id]/report-card/page.tsx` (guard then `ReportCardView`), both Server Components
    - _Requirements: 5.4, 15.3, 19.1_

  - [x] 12.2 Make the admin Customers workspace read-only for Dietitians
    - In `CustomerDashboard.tsx` replace the Shop Orders and Onboarding CTAs with Log Customer and remove every create, edit, deactivate, mutating-export and bulk-import control when the Access_Level is `dietitian`, leaving other levels untouched
    - _Requirements: 15.1, 16.1, 16.6_

  - [x]* 12.3 Write property test for the read-only workspace
    - **Property 28: The read-only workspace renders the customer's data and adherence numbers, with all mutating controls removed**
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 23.1, 23.2**

  - [x]* 12.4 Write property test for the Log Customer call to action
    - **Property 29: The Log Customer call to action replaces the onboarding calls to action for Dietitians**
    - **Validates: Requirements 15.1, 15.2, 23.3**

  - [x] 12.5 Extend `Customer360Dashboard.tsx`
    - Dietitian dropdown in the Clinic Assignment card for Core `KIT` customers with the `Assign a clinic first` disabled state, an editable all-Dietitians dropdown for `ACCOMMODATION`, read-only Clinic and Dietitian text for franchise customers, plus the Health_Log timeline, adherence panel and Report Card action
    - _Requirements: 8.1, 8.2, 8.3, 8.7, 8.9, 9.5, 16.2, 19.1_

  - [x] 12.6 Add the Dietitian step to Meal onboarding
    - In `QuickOnboardingForm.tsx` show a Dietitian dropdown after the address step for Core `MEAL` sessions, disabled with `Complete the address to load dietitians` until a Clinic resolves, reloaded and cleared on a Clinic change, pre-selected when the Clinic has exactly one active Dietitian, showing `No dietitian is assigned to this clinic` when it has none, and read-only for franchise sessions
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.8_

  - [x] 12.7 Add the Dietitian field to Accommodation onboarding
    - Add an all-Dietitians dropdown to the Category & Plan step, allow completion with an empty link, and persist the link atomically with the Customer_Record
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 13. Franchise Portal surfaces

  - [x] 13.1 Add the franchise Dietitian pages
    - Create `src/app/franchise/(main)/log-customer/page.tsx`, `src/app/franchise/(main)/customers/[id]/report-card/page.tsx` and `src/app/franchise/(main)/dietitian-activity/page.tsx`, all rendering the shared components and importing nothing from `src/app/admin`
    - Gate the activity page on the customers group and show `No dietitian is assigned to this franchise` when the Franchise has none
    - _Requirements: 23.4, 23.5, 23.6, 23.7, 24.1, 24.2, 24.3, 24.4, 24.5_

  - [x] 13.2 Make the franchise Customers workspace read-only for Franchise Dietitians
    - In `FranchiseCustomerDashboard.tsx` replace Quick Onboard and Create Customer with Log Customer and remove create/edit/deactivate controls for `dietitian` only, and reject franchise-user create/edit/delete in the portal
    - _Requirements: 21.4, 23.1, 23.2, 23.3_

  - [x]* 13.3 Write property test for portal isolation
    - **Property 36: The Franchise Portal imports nothing from the Admin Portal**
    - **Validates: Requirements 23.7**

- [x] 14. Integration, smoke and regression tests

  - [x]* 14.1 Write RLS integration tests
    - Query `customer_profiles` and `health_logs` on the anon key as a core Dietitian with a Clinic, a core Dietitian without a Clinic and a franchise Dietitian; assert each result set equals what `dietitianCanRead` returns for the same fixtures
    - _Requirements: 5.7, 21.8, 21.11_

  - [x]* 14.2 Write the concurrency and auth integration tests
    - Two concurrent Franchise Dietitian inserts leave exactly one active Dietitian; a banned Dietitian auth account cannot sign in
    - _Requirements: 2.12, 3.11, 10.5_

  - [x]* 14.3 Write smoke tests
    - The five storages, their indexes and RLS policies exist; `users_mobile_key` exists; both activity paths call the shared cadence module; the franchise Log Customer page renders the shared form, filters and report view; one Report_Card PDF renders to a non-empty buffer
    - _Requirements: 2.8, 19.6, 20.8, 23.4, 23.5, 23.6, 24.5, 26.1, 26.2, 26.7_

  - [x]* 14.4 Run the pre-feature regression suites unmodified
    - Existing `src/lib/auth/__tests__`, KIT tracker and accommodation health-log suites must pass with no expectation edits
    - _Requirements: 25.5, 26.3, 26.5, 26.6_

- [x] 15. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP; each property task names the design property it implements.
- The franchise portal directory is `src/app/franchise` (served on the `franchies` subdomain); it imports shared logging code from `src/shared` only.
- Dietitian reads go through the SSR client so the RLS policies stay load-bearing; writes go through the service-role client behind `checkDietitianScope`.
- The Cadence_Engine is the single source of every pending/overdue number — the master report, franchise report, Log Customer list and Report_Card all call it.
- Every property test runs at least 100 `fast-check` iterations and opens with the `// Feature: dietitian-management, Property {n}` tag.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "1.5", "2.3", "2.6", "2.8", "2.10", "2.12", "2.15", "3.1"] },
    { "id": 2, "tasks": ["1.4", "1.6", "2.4", "2.5", "2.7", "2.9", "2.11", "2.13", "2.14", "2.16", "3.2", "3.3", "3.4", "5.1", "5.2"] },
    { "id": 3, "tasks": ["3.5", "3.6", "5.3", "5.4", "6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["7.1", "7.5", "7.12", "7.16"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.6", "7.7", "7.8", "7.9", "7.10", "7.11", "7.13", "7.14", "7.15", "7.17"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7"] },
    { "id": 7, "tasks": ["9.8", "9.9", "9.10", "10.1", "10.3", "10.5", "10.6", "10.8", "10.9"] },
    { "id": 8, "tasks": ["10.2", "10.4", "10.7", "10.10", "11.1", "11.3", "11.5", "12.1", "12.2", "12.5", "12.6", "12.7", "13.1", "13.2"] },
    { "id": 9, "tasks": ["11.2", "11.4", "12.3", "12.4", "13.3", "14.1", "14.2", "14.3", "14.4"] }
  ]
}
```
