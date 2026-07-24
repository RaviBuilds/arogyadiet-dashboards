# Implementation Plan: Mandatory Profile Completion Pop-up

## Overview

This plan generalizes the existing accommodation-only mandatory completion behavior in the shared `ProfileCompletionDialog` to also cover MEAL and KIT customers. Work builds from the server layer outward: first extend `OnboardingService.completeProfile` to accept and persist a medical payload with a server-side mandatory check, then extend the session-authenticated `markOnboardingCompletedAction`, then generalize the client `ProfileCompletionDialog` (mandatory gating, inline upload, close-only skip, completion routing), and finally restyle it to the Dashboard Design Language. No database schema changes are required. Each step builds on the previous and ends with the dialog fully wired to the extended server path.

## Tasks

- [x] 1. Extend `OnboardingService.completeProfile` for mandatory medical completion
  - [x] 1.1 Add optional medical fields to `CompleteProfileOptions` and persistence logic
    - Extend `CompleteProfileOptions` in `src/services/OnboardingService.ts` with `requireMedicalHistory?: boolean`, `medicalHistoryConfirmed?: boolean`, and `medicalDocuments?: Array<{ name: string; url: string; type: string }>`
    - Add a server-side mandatory check ordered before the profile-field write: when `requireMedicalHistory` is set, reject with a `VALIDATION` result and a `medicalHistoryNotes` field error unless `medicalHistoryConfirmed === true` OR `input.medicalHistoryNotes` has non-whitespace content, persisting nothing and leaving `onboarding_status` unchanged
    - When `medicalHistoryConfirmed` is true, persist `medical_history_notes = null` and `medical_history_confirmed = true`; otherwise persist trimmed notes and `medical_history_confirmed = false` (mirror `completeAccommodationProfileAction`)
    - When `medicalDocuments` is provided, include `medical_documents` (JSONB) in the profile patch; an empty/absent array persists an empty field
    - Reuse the existing atomic `updateProfileFields` + `setOnboardingCompleted` sequence so persistence stays all-or-nothing and only writes `COMPLETED` on success
    - Leave `shouldShowProfileCompletionDialog(status)` unchanged
    - _Requirements: 1.2, 1.3, 2.5, 2.6, 4.2, 4.3, 4.5_

  - [x]* 1.2 Write property test for mandatory medical-history gating
    - Extend `src/services/__tests__/profileCompletion.property.test.ts`
    - **Property 2: Mandatory medical history gates completion**
    - **Validates: Requirements 1.2, 1.3**
    - Tag: `Feature: mandatory-profile-completion-popup, Property 2`; use `fast-check` with min 100 runs and in-memory repository fakes

  - [x]* 1.3 Write property test for completion persistence
    - Extend `src/services/__tests__/profileCompletion.property.test.ts`
    - **Property 3: Completion persists exactly the provided profile, medical history, and documents**
    - **Validates: Requirements 2.5, 4.2, 4.3, 4.5**
    - Tag: `Feature: mandatory-profile-completion-popup, Property 3`; use `fast-check` with min 100 runs

  - [x]* 1.4 Write property test for dialog visibility gate
    - Extend `src/services/__tests__/profileCompletion.property.test.ts` (raise existing `numRuns` to 100 where applicable)
    - **Property 1: Dialog visibility is driven solely by IN_PROGRESS status**
    - **Validates: Requirements 2.3, 2.4, 2.7**
    - Tag: `Feature: mandatory-profile-completion-popup, Property 1`; cover enum states plus non-enum strings, empty string, `null`, and `undefined`

- [x] 2. Extend `markOnboardingCompletedAction` with a medical payload
  - [x] 2.1 Add optional medical extras argument to the server action
    - In `src/actions/profileCompletionActions.ts`, export a new `MarkCompletedMedicalExtras` type (`medicalHistoryConfirmed?: boolean`, `medicalDocuments?: Array<{ name: string; url: string; type: string }>`)
    - Extend `markOnboardingCompletedAction(input, medical?)` to thread `medicalHistoryConfirmed`, `medicalDocuments`, and `requireMedicalHistory: true` into `completeProfile` using the session-resolved `profileId`/`userId` from `resolveAuthenticatedCustomer`
    - Preserve existing behavior: return `{ error }` on auth failure, `toActionError` on failed result, and `revalidatePath("/dashboard")` on success
    - Keep `saveProfileCompletionAction` and `submitRealEmailAction` unchanged so existing callers still compile
    - _Requirements: 2.5, 4.1, 4.2, 4.3, 4.4_

  - [x]* 2.2 Write integration test for medical payload threading
    - Verify `markOnboardingCompletedAction` passes the medical payload into `completeProfile` and persists `medical_documents` / `medical_history_*`, and that a persistence failure leaves `onboarding_status` as `IN_PROGRESS`
    - _Requirements: 2.6, 4.2, 4.3, 4.4_

- [x] 3. Checkpoint - Ensure server-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Generalize `ProfileCompletionDialog` gating and completion routing
  - [x] 4.1 Introduce `requiresMandatoryCompletion` flag and mandatory medical history
    - In `src/shared/components/customer/ProfileCompletionDialog.tsx`, keep `isAccommodation` only for the stay-vs-subscription presentation choice; add `requiresMandatoryCompletion` (true for MEAL, KIT, ACCOMMODATION; unknown/null falls back to legacy optional behavior)
    - Key the always-shown mandatory medical-history block and the "no medical history" confirmation checkbox off `requiresMandatoryCompletion`
    - Rename `accommodationProfileComplete` to `mandatoryProfileComplete` (`medicalHistoryConfirmed || notes.trim().length > 0`) and set the complete button `disabled={isBusy || (requiresMandatoryCompletion && !mandatoryProfileComplete)}`, conveying the disabled state to assistive technologies
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.3_

  - [x] 4.2 Render inline medical document upload for MEAL/KIT and hide "Skip for now"
    - Render the existing inline upload control when `requiresMandatoryCompletion` (was `isAccommodation`), reusing `handleDocumentSelect`/`removeDocument`/`uploadMedicalDocuments` and the constants `MAX_MEDICAL_DOCUMENT_FILES = 5`, `MAX_MEDICAL_DOCUMENT_SIZE_MB = 10` verbatim
    - Hide the "Skip for now" button whenever `requiresMandatoryCompletion`, relying on the Radix Dialog's built-in close control as the temporary skip; persist nothing on close
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 6.1_

  - [x] 4.3 Route MEAL/KIT completion through the extended server action
    - Generalize `runAccommodationComplete` into `runMandatoryComplete`: upload documents client-side via `uploadMedicalDocuments()` first (aborting completion if it throws so status stays `IN_PROGRESS`), then branch on category for the action only — keep the unchanged `completeAccommodationProfileAction` path for ACCOMMODATION, and call `markOnboardingCompletedAction(buildPayload(values), { medicalHistoryConfirmed, medicalDocuments: uploadedDocuments })` for MEAL/KIT
    - Keep the "Save" (optional persistence) path unchanged for all categories, and keep the public props interface unchanged
    - _Requirements: 1.4, 2.5, 4.1, 4.4, 4.5, 5.2, 5.3_

  - [x]* 4.4 Write property test for medical document selection limits
    - Extend `src/shared/components/customer/__tests__/ProfileCompletionDialog.test.tsx` (or a co-located helper test) for the `handleDocumentSelect` validation logic
    - **Property 4: Medical document selection enforces type, size, and count limits**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
    - Tag: `Feature: mandatory-profile-completion-popup, Property 4`; use `fast-check` with min 100 runs over varied MIME types and sizes

  - [x]* 4.5 Write component tests for MEAL/KIT mandatory behavior
    - Extend `src/shared/components/customer/__tests__/ProfileCompletionDialog.test.tsx`
    - Assert: complete button disabled until notes entered or checkbox checked (Req 1.2/1.3); upload control present for MEAL/KIT (Req 3.1); no "Skip for now" button rendered (Req 2.2/6.1); descriptive file-validation error messages (Req 3.5–3.7)
    - _Requirements: 1.2, 1.3, 2.2, 3.1, 3.5, 3.6, 3.7, 6.1_

- [x] 5. Checkpoint - Ensure dialog behavior tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Restyle `ProfileCompletionDialog` to the Dashboard Design Language
  - [x] 6.1 Apply dashboard card, palette, iconography, and typography tokens
    - Restyle `src/shared/components/customer/ProfileCompletionDialog.tsx` per the Dashboard Design Language Mapping: `rounded-2xl border border-slate-200 bg-white shadow-sm` section blocks; emerald/slate palette with coral/amber accents; icon-badged section headers (`rounded-full bg-emerald-100 p-1.5` with an icon + title) for subscription/stay, medical history, and medical documents sections; dashboard typography/spacing scale; rounded pill footer CTAs with `min-h-11` tap targets
    - Preserve the Radix `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription` structure, focus trap/restore, every `<FieldLabel>`/input association, and the full functional flow from Requirements 1–6 (styling-only pass)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 6.2 Extend accessibility tests for the restyled dialog
    - Extend `src/test/a11y/onboarding-a11y.test.tsx` to assert the restyled dialog keeps labeled inputs and conveys the disabled complete-button state to assistive technologies
    - _Requirements: 6.2, 6.3, 6.6_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP.
- Each task references specific requirement sub-clauses for traceability.
- Property tests use `fast-check` (already in the repo) with a minimum of 100 iterations and are tagged `Feature: mandatory-profile-completion-popup, Property N`.
- No database schema changes or migrations are required; existing `customer_profiles` columns and the `medical_records` bucket are reused.
- The `/dashboard` page and `shouldShowProfileCompletionDialog` are intentionally unchanged.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "4.1"] },
    { "id": 3, "tasks": ["1.4", "4.2"] },
    { "id": 4, "tasks": ["4.3"] },
    { "id": 5, "tasks": ["4.4", "6.1"] },
    { "id": 6, "tasks": ["4.5", "6.2"] }
  ]
}
```
