# Requirements Document

## Introduction

After a customer is onboarded by an admin, the customer sees a "Complete your profile" pop-up when they log into the customer portal (customer.arogyadiet.com). Today this pop-up is rendered by a single shared client component (`ProfileCompletionDialog`) that is mounted by the dashboard route whenever the customer's onboarding status is `IN_PROGRESS`.

The pop-up currently behaves differently by customer category:
- **MEAL** and **KIT** customers: all fields are optional, a permanent "Skip for now" button is shown, and there is no medical document upload.
- **ACCOMMODATION** customers: medical history is mandatory, medical documents can be uploaded inline, the "Skip for now" button is removed, and the pop-up reappears on the next dashboard visit until completed.

This feature makes MEAL and KIT customers follow the SAME behavior that ACCOMMODATION customers already have: the profile completion pop-up becomes mandatory, medical documents can be attached inline, and the pop-up keeps reappearing on the dashboard route until the customer explicitly completes onboarding. The "Skip for now" action becomes a temporary dismissal that only closes the dialog for the current session and re-triggers on the next dashboard navigation.

This document defines requirements only. No code changes are made here.

## Glossary

- **Profile_Completion_Dialog**: The shared client component (`src/shared/components/customer/ProfileCompletionDialog.tsx`) that renders the "Complete your profile" pop-up for all customer categories.
- **Dashboard_Route**: The customer portal route `/dashboard`, rendered by `src/app/customer/(main)/dashboard/page.tsx`, which conditionally mounts the Profile_Completion_Dialog.
- **Customer_Category**: The classification of a customer as `MEAL`, `KIT`, or `ACCOMMODATION`.
- **Onboarding_Status**: The value stored in `customer_profiles.onboarding_status`, one of `IN_PROGRESS` or `COMPLETED`, that governs whether the dialog is shown.
- **Onboarding_Service**: The service (`src/services/OnboardingService.ts`) exposing `shouldShowProfileCompletionDialog(status)`, which returns true while Onboarding_Status is `IN_PROGRESS`.
- **Medical_History_Field**: The medical-history textarea inside the Profile_Completion_Dialog.
- **No_Medical_History_Confirmation**: The "I have no medical history" checkbox that satisfies the medical-history requirement when checked.
- **Medical_Document_Upload_Control**: The inline control inside the Profile_Completion_Dialog for attaching medical documents (images/PDF), mirroring `src/shared/components/customer/medical-document-upload-modal.tsx`.
- **Medical_Records_Bucket**: The private Supabase storage bucket `medical_records` used to store uploaded medical document files.
- **Medical_Documents_Field**: The `customer_profiles.medical_documents` field where medical document references are persisted.
- **Skip_For_Now_Action**: The user action that temporarily closes the Profile_Completion_Dialog without persisting completion.
- **Mark_Completed_Action**: The user action ("Mark completed onboarding") that persists profile completion and sets Onboarding_Status to `COMPLETED`.
- **Profile_Completion_Server_Action**: The server action that persists profile completion, medical history, and medical documents for MEAL/KIT customers (in `src/actions/profileCompletionActions.ts`, mirroring the accommodation flow in `src/actions/accommodationOnboardingActions.ts`).
- **Dashboard_Design_Language**: The established visual design system used by the customer dashboard (`src/app/customer/(main)/dashboard/page.tsx`, `KitDashboard.tsx`, and shared components under `src/shared/components/customer/dashboard/` such as JourneyHeader, TodayFocusCard, MomentumStrip, and UpcomingDeliveries), characterized by card-based layouts with `rounded-2xl` cards, soft slate borders, subtle `shadow-sm` shadows, an emerald/slate color palette with coral/amber accents, icon-badged section headers (an icon inside a rounded colored badge, e.g. `emerald-100`, next to a title), consistent typography and spacing, and `reveal-rise` reveal/animation utilities.

## Requirements

### Requirement 1: Mandatory dialog for MEAL and KIT customers

**User Story:** As a business operator, I want the profile completion pop-up to be mandatory for MEAL and KIT customers, so that these customers provide required profile and medical information before they finish onboarding.

#### Acceptance Criteria

1. WHERE the Customer_Category is MEAL or KIT, THE Profile_Completion_Dialog SHALL apply the same mandatory-completion behavior currently applied to ACCOMMODATION customers.
2. WHERE the Customer_Category is MEAL or KIT, THE Profile_Completion_Dialog SHALL require the Medical_History_Field to contain text OR the No_Medical_History_Confirmation to be checked before the Mark_Completed_Action can be invoked.
3. WHILE the Medical_History_Field is empty AND the No_Medical_History_Confirmation is unchecked, THE Profile_Completion_Dialog SHALL keep the Mark_Completed_Action control disabled.
4. WHERE the Customer_Category is ACCOMMODATION, THE Profile_Completion_Dialog SHALL retain the existing mandatory-completion behavior without change.

### Requirement 2: Remove permanent "Skip for now" dismissal and reappear on dashboard

**User Story:** As a business operator, I want the pop-up to reappear every time a MEAL or KIT customer returns to the dashboard until they complete onboarding, so that skipping cannot permanently avoid profile completion.

#### Acceptance Criteria

1. WHERE the Customer_Category is MEAL or KIT, THE Profile_Completion_Dialog SHALL NOT persist any state that permanently prevents the dialog from reappearing.
2. WHEN a MEAL or KIT customer invokes the Skip_For_Now_Action, THE Profile_Completion_Dialog SHALL close and allow the customer to browse the application.
3. WHEN a MEAL or KIT customer navigates to the Dashboard_Route AND Onboarding_Status is `IN_PROGRESS`, THE Dashboard_Route SHALL mount the Profile_Completion_Dialog.
4. WHILE Onboarding_Status is `IN_PROGRESS`, THE Onboarding_Service SHALL return true from `shouldShowProfileCompletionDialog(status)` regardless of prior Skip_For_Now_Action invocations.
5. WHEN a MEAL or KIT customer completes the Mark_Completed_Action AND the Profile_Completion_Server_Action succeeds, THE Profile_Completion_Server_Action SHALL set Onboarding_Status to `COMPLETED`.
6. IF the Profile_Completion_Server_Action fails to persist the profile completion, THEN THE Profile_Completion_Server_Action SHALL leave Onboarding_Status as `IN_PROGRESS`.
7. WHEN Onboarding_Status is `COMPLETED` AND a customer navigates to the Dashboard_Route, THE Dashboard_Route SHALL NOT mount the Profile_Completion_Dialog.

### Requirement 3: Inline medical document attachment for MEAL and KIT customers

**User Story:** As a MEAL or KIT customer, I want to attach my medical documents directly in the profile completion pop-up, so that I can provide my medical records without a separate step.

#### Acceptance Criteria

1. WHERE the Customer_Category is MEAL or KIT, THE Profile_Completion_Dialog SHALL display the Medical_Document_Upload_Control using the existing medical-document attachment pattern.
2. THE Medical_Document_Upload_Control SHALL accept image files and PDF files.
3. THE Medical_Document_Upload_Control SHALL accept a maximum of 5 files.
4. THE Medical_Document_Upload_Control SHALL reject any single file larger than 10 megabytes.
5. IF a customer selects a file with an unsupported type, THEN THE Medical_Document_Upload_Control SHALL reject the file and display a descriptive error message.
6. IF a customer selects a file larger than 10 megabytes, THEN THE Medical_Document_Upload_Control SHALL reject the file and display a descriptive error message.
7. IF a customer attempts to attach more than 5 files, THEN THE Medical_Document_Upload_Control SHALL reject the additional files and display a descriptive error message.

### Requirement 4: Persist profile completion and medical documents

**User Story:** As a MEAL or KIT customer, I want my submitted profile details and medical documents to be saved when I complete onboarding, so that my information is available to the business afterward.

#### Acceptance Criteria

1. WHEN a MEAL or KIT customer invokes the Mark_Completed_Action with valid input, THE Profile_Completion_Server_Action SHALL upload each attached medical document file to the Medical_Records_Bucket.
2. WHEN a MEAL or KIT customer invokes the Mark_Completed_Action with valid input, THE Profile_Completion_Server_Action SHALL persist references to the uploaded files in the Medical_Documents_Field.
3. WHEN a MEAL or KIT customer invokes the Mark_Completed_Action with valid input, THE Profile_Completion_Server_Action SHALL persist the Medical_History_Field content to the customer profile.
4. IF the Profile_Completion_Server_Action fails to upload a medical document file, THEN THE Profile_Completion_Server_Action SHALL return a descriptive error AND SHALL leave Onboarding_Status as `IN_PROGRESS`.
5. WHEN a MEAL or KIT customer invokes the Mark_Completed_Action without attaching any medical document, THE Profile_Completion_Server_Action SHALL persist the profile completion using an empty Medical_Documents_Field.

### Requirement 5: Reuse existing components and storage

**User Story:** As a developer, I want the mandatory pop-up to reuse existing medical document components and storage, so that behavior stays consistent and no duplicate implementations are introduced.

#### Acceptance Criteria

1. THE Profile_Completion_Dialog SHALL reuse the existing medical-document attachment pattern rather than introduce a new upload component.
2. THE Profile_Completion_Server_Action SHALL store medical document files in the existing Medical_Records_Bucket rather than a new storage location.
3. THE Profile_Completion_Dialog SHALL remain the single shared component used for MEAL, KIT, and ACCOMMODATION customer categories.

### Requirement 6: Accessibility and consistency of the pop-up

**User Story:** As a customer using assistive technology, I want the mandatory pop-up to be operable and consistent, so that I can complete onboarding regardless of how I interact with the application.

#### Acceptance Criteria

1. THE Profile_Completion_Dialog SHALL expose the built-in dialog close control as the mechanism for the Skip_For_Now_Action for MEAL and KIT customers.
2. THE Profile_Completion_Dialog SHALL associate each input control with a visible label.
3. WHEN the Mark_Completed_Action control is disabled, THE Profile_Completion_Dialog SHALL convey the disabled state to assistive technologies.

### Requirement 7: Visual and UX consistency with the customer dashboard

**User Story:** As a customer, I want the profile completion pop-up to look and feel like the rest of the customer dashboard, so that the experience feels cohesive and familiar.

#### Acceptance Criteria

1. THE Profile_Completion_Dialog SHALL adopt the Dashboard_Design_Language for its visual presentation.
2. THE Profile_Completion_Dialog SHALL apply card styling consistent with the Dashboard_Design_Language, using rounded corners, soft slate borders, and subtle shadows.
3. THE Profile_Completion_Dialog SHALL use the emerald/slate color palette (with coral/amber accents) defined by the Dashboard_Design_Language.
4. WHERE the Profile_Completion_Dialog presents a section header, THE Profile_Completion_Dialog SHALL render an icon inside a rounded colored badge next to the section title, consistent with the Dashboard_Design_Language.
5. THE Profile_Completion_Dialog SHALL apply typography and spacing consistent with the Dashboard_Design_Language.
6. THE Profile_Completion_Dialog SHALL preserve the existing Radix Dialog structure, focus management, and accessibility behavior while adopting the Dashboard_Design_Language.
7. THE Profile_Completion_Dialog SHALL preserve the functional onboarding flow defined in Requirements 1 through 6 while adopting the Dashboard_Design_Language.
