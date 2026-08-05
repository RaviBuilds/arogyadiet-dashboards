# Requirements Document

## Introduction

This feature turns the Report_Card from a derived document into a persisted, closable entity with a lifecycle.

Before this feature, `DietitianReportService` assembled a Report_Card on every request from `getHealthLogTimeline(customerProfileId)`, which reads `v_health_log_timeline` filtered only by customer with no date bound. One document therefore spanned a customer's entire history across every subscription and stay. There was nothing to close, nothing to lock, and no way to state which subscription a report covered.

This feature introduces one Report_Card per MEAL/KIT subscription and one per accommodation stay. A Dietitian fills that period's Log_Slots, writes a report-level Closing_Comment, and finalises the report. Finalising makes the period's logs read-only and produces a Final_Report for that dated period. When the customer buys their next subscription, a new Report_Card and a new set of Log_Slots appear, while every earlier report stays visible in a history list — including any whose slots were never finished, so a Dietitian can return to an older subscription after a newer one has already started.

Finalisation is reversible exactly once removed: the customer's most recently closed report may be reopened, amended and re-closed any number of times while it holds that position. Every older closed report is permanently locked for everyone, including MASTER_ADMIN. Closing the current report shifts that window forward rather than widening it.

The feature spans:

- **Admin Portal** (`admin.arogyadiet.com`) — the Dietitian's Log Customer workflow at `/log-customer/[id]`, where the history list, the per-report slot view, the finalise/reopen controls and the Final_Report render.
- **Franchise Portal** (`franchies.arogyadiet.com`) — the same Log Customer workflow for a Franchise Dietitian, at `/log-customer/[id]`.

It applies to all three Customer_Categories. This is a widening of scope relative to the existing customer-wide Report_Card PDF, which `reportCardActions.ts` restricts to KIT and ACCOMMODATION; that restriction stays where it is and does not carry over here.

### Baseline observed in the existing system

These facts were verified against the live schema, live data and the code, and constrain the requirements below.

**Verified in live data on 2026-08-04:**

- 236 Report_Cards were created by the backfill: 199 for subscriptions, 37 for stays, all ACTIVE, none CLOSED.
- The entire database holds **4 Dietitian_Logs**. All 4 attributed to exactly one candidate Report_Card; 0 were left unattributed.
- 11 overlapping subscription-window pairs exist, and **0 of them are ACTIVE-vs-ACTIVE**. The product owner's rule — at most one ACTIVE MEAL / KIT / stay record per customer, the next starting only after the previous moves to EXPIRED — holds in the data.
- The overlaps come from backdated creation, not concurrency. One bulk import on 2026-07-03 created 84 subscriptions, 82 of them backdated by up to 568 days, so a plan created in July retroactively covers a period a different, already-expired plan actually served. Worked example, customer `1d3a82da-…`: `SUB-MNWRH5` ran 28 May → 16 Jun 2026 (EXPIRED, created 27 May) and `SUB-7EUHE2` runs 19 May → 16 Aug 2026 (ACTIVE, created 3 Jul, backdated 45 days). Their windows overlap 28 May – 16 Jun.
- An ACTIVE KIT subscription legitimately carries `starts_on IS NULL` and `ends_on IS NULL` until the customer confirms receipt; its window exists only via `kit_received_date`. One such row exists, and it owns one of the 4 Dietitian_Logs.

**Verified in schema and code:**

- `health_logs` carries `health_logs_one_dietitian_log_per_day`, a unique index permitting only one Dietitian_Log per customer per calendar day.
- `health_logs` had no `subscription_id` and no `stay_entry_id` before this feature; Log_Slots were computed on every read and never stored.
- Logging_Window formulas live in `cadenceRepository.getGoverningRecords`: MEAL is `starts_on → effective_end_on ?? ends_on ?? starts_on`; KIT is `kit_received_date ?? starts_on → kit_tracker_end_date ?? effective_end_on ?? ends_on ?? window_start`; ACCOMMODATION is `stay.start_date → start_date + total_nights - 1`.
- `v_health_log_timeline` is a `UNION ALL` over `health_logs`, `admin_health_logs`, `customer_health_logs` and `kit_daily_logs`. The three legacy tables have no `report_card_id` column.
- `HealthLogService` enforces a same-day edit window (a log may be edited only on its `submission_date_ist`) and an authorship rule (only the original author may edit).
- A Stay_Extension prolongs the same `stay_entries` row rather than creating a new one, so extended nights already fall inside one stay's window.
- Row Level Security is enabled on every public table; `health_logs` grants SELECT/INSERT/UPDATE with no DELETE grant and no DELETE policy.
- `checkDietitianScope(customerProfileId)` is the established authorisation gate for Dietitian actions.

## Glossary

- **Adherence_Figures**: The per-period counts of Dietitian_Logs, Pending_Logs, Self_Logs, Skipped_Self_Logs and Paused_Days.
- **Amendment_Mode**: The relaxed edit state of a Report_Card that has been reopened, in which the same-day edit window no longer applies to its logs.
- **Cadence_Engine**: The component that computes Cadence_Interval, Eligible_Day and Log_Slot schedules, implemented in `src/lib/dietitian/logSlots.ts` and `cadenceRepository`.
- **Closing_Comment**: The mandatory per-day free-text note on an individual Health_Log. Distinct from Report_Closing_Comment.
- **Customer_Category**: One of `MEAL`, `KIT`, `ACCOMMODATION`.
- **Dietitian**: A user whose role is `ADMIN` or `FRANCHISE_ADMIN` and whose Access_Level is `dietitian`.
- **Dietitian_Log**: A Health_Log whose author is a Dietitian.
- **Editability_Model**: The database view that derives, per Report_Card, whether it may still be written to and whether it may be reopened.
- **Final_Report**: The rendered report for one closed period: its Report_Closing_Comment, Adherence_Figures, Parameter_Table and per-day Closing_Comment history.
- **Governing_Record**: The subscription or stay the Cadence_Engine currently considers authoritative for a customer, as returned by `getGoverningRecords`.
- **Health_Log**: A dated record of health measurements for one Customer_Record, authored by a Dietitian or the customer.
- **Log_Slot**: One scheduled Dietitian_Log deadline inside a Logging_Window, derived from the Cadence_Interval and excluding Paused_Days.
- **Logging_Window**: The inclusive date interval a Report_Card covers, computed per Customer_Category as recorded in the baseline above.
- **Parameter_Table**: The dated table of health readings recorded inside a Logging_Window, including Custom_Parameters.
- **Permanently_Locked**: The state of a closed Report_Card that is not the customer's most recently closed one. It can be read but never written, reopened or deleted, by any role.
- **Report_Card**: A persisted row representing the report for exactly one Subject, carrying its Logging_Window snapshot, its status and its Report_Closing_Comment.
- **Report_Closing_Comment**: The report-level free-text summary a Dietitian writes when finalising a Report_Card.
- **Reopen_Window**: The single most recently closed Report_Card per customer — the only closed report that may be reopened.
- **Retrospective_Report**: A Report_Card whose Logging_Window had already ended before the Report_Card itself existed, so its Log_Slots could never have been logged on their deadline dates. Formally: `window_end` is strictly earlier than the Report_Card's own creation date in IST.
- **Self_Log**: A Health_Log whose author is the customer.
- **Subject**: The record a Report_Card covers: a subscription for `MEAL` and `KIT`, a stay for `ACCOMMODATION`.
- **Write_Gate**: The server-side check in the Health_Log write path that refuses a write landing in a non-editable Report_Card.

## Requirements

### Requirement 1: Report_Card as a persisted entity

**User Story:** As a dietitian, I want each subscription or stay to have its own report, so that a finished period can be closed without affecting the customer's other periods.

#### Acceptance Criteria

1. THE system SHALL persist one Report_Card per Subject, where the Subject is a subscription for Customer_Category `MEAL` and `KIT`, and a stay for Customer_Category `ACCOMMODATION`.
2. THE system SHALL permit at most one Report_Card per subscription and at most one Report_Card per stay.
3. THE system SHALL require exactly one Subject reference to be set on a Report_Card, matching its declared subject type, and SHALL reject a Report_Card that references both a subscription and a stay, or neither.
4. THE system SHALL record on each Report_Card the Logging_Window it covers, as an inclusive start and end date.
5. THE system SHALL permit more than one ACTIVE Report_Card per customer, so that an unfinished older period coexists with the current one.
6. WHERE a Subject has no resolvable Logging_Window start, THE system SHALL create no Report_Card for it rather than substituting a date.
7. WHERE a Subject is an ACTIVE KIT subscription whose `starts_on` is NULL pending receipt confirmation, THE system SHALL resolve its Logging_Window start from `kit_received_date` and SHALL create a Report_Card for it.

### Requirement 2: Accommodation stays and extensions

**User Story:** As an admin, I want an extended stay to stay on one report, so that a guest who extends does not end up with two half-reports for one visit.

#### Acceptance Criteria

1. THE system SHALL key an accommodation Report_Card to the stay, not to the subscription.
2. WHEN a Stay_Extension prolongs a stay, THE system SHALL fold the extended nights into the same Report_Card and SHALL NOT create a second Report_Card for that stay.
3. WHILE an accommodation Report_Card is ACTIVE, THE system SHALL refresh its Logging_Window end date to match the stay's current end date.
4. WHEN a Report_Card is finalised, THE system SHALL freeze its Logging_Window, so that a closed report always states the period it actually covered.

### Requirement 3: Attribution of Health_Logs to Report_Cards

**User Story:** As a dietitian, I want every log I write to be attached to the right period's report, so that reports do not borrow each other's readings.

#### Acceptance Criteria

1. WHEN a Dietitian_Log is written for the current period, THE system SHALL attribute it to the Report_Card of the customer's Governing_Record, and SHALL NOT use date matching to choose between candidates.
2. WHERE the customer has no Governing_Record, THE system SHALL treat the situation as "nothing to log against", consistent with the Cadence_Engine's existing report of that state.
3. WHERE a Health_Log falls outside every Logging_Window, THE system SHALL leave it unattributed to any Report_Card and SHALL preserve its existing behaviour.
4. THE system SHALL never destroy a Health_Log as a consequence of its Report_Card being removed.

### Requirement 4: Backfill of existing history

**User Story:** As a master admin, I want existing customers to already have their per-period reports, so that the feature is usable on day one rather than only for new subscriptions.

#### Acceptance Criteria

1. WHEN the Migration_Script executes, THE Migration_Script SHALL create a Report_Card for every existing subscription of Customer_Category `MEAL` or `KIT` and for every existing stay that has a resolvable Logging_Window.
2. THE Migration_Script SHALL create every backfilled Report_Card in the ACTIVE state with no Report_Closing_Comment, because nothing has ever been finalised.
3. WHEN the Migration_Script executes a second time against the same database, THE Migration_Script SHALL leave the schema, the Report_Cards and the log attributions unchanged (idempotence property).
4. WHEN attributing an existing Dietitian_Log whose date falls inside more than one Logging_Window, THE Migration_Script SHALL prefer, in order: the Subject that already existed when the log was written, then the ACTIVE Subject, then the Subject that started most recently while still containing the date, then the most recently created Subject.
5. THE Migration_Script SHALL only ever fill a Health_Log's Report_Card attribution where it is currently absent, and SHALL NOT rewrite an existing attribution.

### Requirement 5: Finalising a Report_Card

**User Story:** As a dietitian, I want to write a closing summary and finalise a period once all its slots are logged, so that the completed period produces a report the customer can be given.

#### Acceptance Criteria

1. THE system SHALL accept a finalise request only for a Report_Card that is ACTIVE, and SHALL reject a request to finalise a closed Report_Card.
2. THE system SHALL require a non-empty Report_Closing_Comment of at most 4000 characters, and SHALL reject a finalise request without one.
3. WHERE a Report_Card is not a Retrospective_Report as defined in Requirement 18, THE system SHALL reject a finalise request unless every Log_Slot in the Report_Card's Logging_Window carries a Dietitian_Log.
4. WHERE a Report_Card is not a Retrospective_Report as defined in Requirement 18 AND its Logging_Window schedules no Log_Slots, THE system SHALL reject a finalise request, because the resulting report would be empty.
5. WHEN a finalise request is rejected, THE system SHALL state which precondition failed, and WHERE slots are outstanding THE system SHALL state how many.
6. WHEN a Report_Card is finalised, THE system SHALL record the finalisation timestamp and the finalising user.
7. WHEN two finalise requests for the same Report_Card are processed concurrently, THE system SHALL close it once and SHALL tell the losing caller the report is already closed, rather than overwriting the winner's Report_Closing_Comment (concurrency property).
8. THE system SHALL require a closed Report_Card to carry both a Report_Closing_Comment and a finalisation timestamp, and SHALL require an ACTIVE Report_Card to carry no finalisation timestamp, enforced at the database level.

### Requirement 6: Reopening the most recently closed report

**User Story:** As a dietitian, I want to reopen the report I just closed if I got something wrong, so that a mistake does not become permanent the moment I click finalise.

#### Acceptance Criteria

1. THE system SHALL treat exactly one Report_Card per customer as reopenable: the most recently closed one.
2. THE system SHALL permit that Report_Card to be reopened, amended and re-closed any number of times while it holds that position.
3. THE system SHALL reject a reopen request for any closed Report_Card that is not the most recently closed one, for every role including MASTER_ADMIN.
4. THE system SHALL reject a reopen request for a Report_Card that is not closed.
5. WHEN a Report_Card is reopened, THE system SHALL increment its reopen count and record the reopening timestamp and user.
6. WHEN a newer Report_Card is finalised, THE system SHALL make that newer report the reopenable one and SHALL Permanently_Lock the previously reopenable report, without any additional write to the previously reopenable row.
7. WHEN two reopen requests for the same Report_Card are processed concurrently, THE system SHALL reopen it once (concurrency property).
8. WHERE two closed Report_Cards share a finalisation timestamp, THE system SHALL still resolve a single reopenable report deterministically.

### Requirement 7: A single definition of the lock rule

**User Story:** As a developer, I want the lock rule expressed in exactly one place, so that the UI cannot offer an action the server will refuse.

#### Acceptance Criteria

1. THE system SHALL derive editability and reopenability in the Editability_Model, as a database view.
2. THE Editability_Model SHALL mark a Report_Card editable WHEN it is ACTIVE, OR WHEN it is the customer's most recently closed Report_Card.
3. THE Editability_Model SHALL mark a Report_Card reopenable only WHEN it is closed AND it is the customer's most recently closed Report_Card.
4. THE Write_Gate, the finalise and reopen paths, and every user interface affordance SHALL read editability and reopenability from the Editability_Model, and SHALL NOT re-derive either from a Report_Card's status.

### Requirement 8: The write lock on a closed period's logs

**User Story:** As a franchise owner, I want a finalised period's logs to be unwritable, so that a report I have already handed to a customer cannot silently change.

#### Acceptance Criteria

1. WHEN a Health_Log write targets a date whose Report_Card is not editable, THE Write_Gate SHALL refuse the write and SHALL explain that the report is locked.
2. THE Write_Gate SHALL resolve the Report_Card for a write by the log's date, not by the customer's Governing_Record, because an edit may target a date inside an older, closed period.
3. WHERE more than one Report_Card's Logging_Window contains the write's date and any of them is not editable, THE Write_Gate SHALL refuse the write (fail-closed property).
4. WHERE no Report_Card's Logging_Window contains the write's date, THE Write_Gate SHALL not refuse the write on lock grounds.
5. WHEN a Report_Card is not editable, THE system SHALL present every Log_Slot in its Logging_Window as read-only.
6. THE system SHALL apply the Write_Gate on the server, independently of any user interface state.

### Requirement 9: Amendment_Mode after a reopen

**User Story:** As a dietitian, I want to correct an earlier day's reading after reopening a report, so that reopening is actually useful rather than only letting me change the summary.

#### Acceptance Criteria

1. WHERE a Report_Card is ACTIVE and has been reopened at least once, THE system SHALL permit its logs to be edited outside the same-day edit window.
2. THE system SHALL NOT relax the authorship rule in Amendment_Mode; only the original author may edit a Health_Log.
3. WHERE a Report_Card is ACTIVE and has never been reopened, THE system SHALL continue to enforce the same-day edit window.
4. THE system SHALL make the relaxation visible, so that a Dietitian understands why an older log has become editable.

### Requirement 10: The report history surface

**User Story:** As a dietitian, I want to see every one of a customer's periods on their log page, so that I can finish an old subscription's report even though a new subscription has already started.

#### Acceptance Criteria

1. THE system SHALL list every Report_Card for a customer on the Log Customer page, newest period first.
2. THE system SHALL show, per listed Report_Card, its period dates, its status, its lock state and its slot-completion progress.
3. THE system SHALL identify which listed Report_Card corresponds to the customer's current Governing_Record.
4. THE system SHALL include Report_Cards whose slots are unfinished, so an older period remains reachable after a newer one begins.
5. WHEN a Logging_Window exists with no Report_Card, THE system SHALL create the missing Report_Card as it reads the history, so the list is complete regardless of when the Subject was created.
6. THE system SHALL provide this surface in both the Admin Portal and the Franchise Portal.
7. THE system SHALL provide this surface for all three Customer_Categories.

### Requirement 11: The Final_Report

**User Story:** As a dietitian, I want the finished report to be what I see when I open a closed period, so that the closed period reads as a report rather than as a grid of slots.

#### Acceptance Criteria

1. WHERE a Report_Card is closed, THE system SHALL present its Final_Report as the primary content for that period.
2. THE Final_Report SHALL lead with the Report_Closing_Comment.
3. THE Final_Report SHALL state the period it covers, its Customer_Category, its finalisation date and its reopen count where non-zero.
4. THE Final_Report SHALL include a Parameter_Table of dated readings recorded inside the Logging_Window, including Custom_Parameters and each reading's author.
5. THE Final_Report SHALL include the per-day Closing_Comment history for the period, collapsed by default so it does not compete with the Report_Closing_Comment.
6. THE system SHALL keep the period's per-slot logs readable after finalisation, collapsed below the Final_Report, so the audit trail is preserved rather than replaced.
7. WHERE a Report_Card is ACTIVE, THE system SHALL be able to render the same view as a preview of what finalising would produce.
8. WHERE a Logging_Window contains no Health_Logs, THE system SHALL say so rather than rendering an empty report.

### Requirement 12: Per-period Adherence_Figures

**User Story:** As a franchise owner, I want a past period's report to show that period's adherence, so that a historical report is not silently restated using today's numbers.

#### Acceptance Criteria

1. THE system SHALL compute Adherence_Figures bounded to the Report_Card's Logging_Window.
2. THE system SHALL NOT reuse the Cadence_Engine's current-customer adherence snapshot for a historical period.
3. THE Adherence_Figures SHALL report the Dietitian_Log count, the outstanding-log count, the Self_Log count, the Skipped_Self_Log count and the Paused_Day count for the period.
4. THE system SHALL exclude Paused_Days from the period's Log_Slot schedule, so that a period's slot count matches the Cadence_Engine's for the same dates.
5. THE system SHALL produce a stable figure for a finished period, so that a later period gaining logs does not change an earlier period's report (stability property).

### Requirement 13: Reading a period's logs across legacy sources

**User Story:** As a dietitian, I want a period's report to include the older Accommodation and KIT readings, so that reports for existing customers are not blank.

#### Acceptance Criteria

1. THE system SHALL assemble a period's log timeline from all four sources in `v_health_log_timeline`.
2. THE system SHALL select a period's logs by Logging_Window date range, and SHALL NOT select them by Report_Card attribution, because the three legacy tables carry no such attribution.
3. THE system SHALL distinguish a Dietitian-authored reading from a customer-authored one in the period's timeline.

### Requirement 14: PDF export of a period report

**User Story:** As a dietitian, I want to download a period's report as a PDF, so that I can give the customer the report for the subscription they just completed.

#### Acceptance Criteria

1. THE system SHALL export a Report_Card's Final_Report as a PDF.
2. THE system SHALL name the exported file so that a customer's several period reports do not collide, by including the period in the filename.
3. WHERE a Logging_Window contains no Health_Logs, THE system SHALL not offer the export and SHALL say why.
4. THE system SHALL transport the PDF to the browser using the same mechanism as the existing Report_Card export.

### Requirement 15: Authorisation and scoping

**User Story:** As a master admin, I want report lifecycle actions restricted to the dietitian who owns the customer, so that one dietitian cannot read or close another's reports.

#### Acceptance Criteria

1. THE system SHALL gate every report lifecycle action on the caller's Dietitian scope over the Report_Card's customer.
2. WHEN a Report_Card is addressed by its own identifier, THE system SHALL resolve its owning customer before performing the scope check.
3. WHEN a Report_Card identifier is unknown, AND WHEN it belongs to a customer outside the caller's scope, THE system SHALL return the same response, so that identifiers cannot be probed for existence.
4. THE system SHALL enforce Row Level Security on Report_Cards using the same customer-scoping predicates as Health_Logs.
5. THE system SHALL permit a Dietitian to log against an accommodation customer, and SHALL NOT change the behaviour of Dietitian log entry for MEAL or KIT customers in doing so.

### Requirement 16: Non-destructibility and audit

**User Story:** As a master admin, I want reports to be undeletable, so that a closed clinical record cannot be made to disappear.

#### Acceptance Criteria

1. THE system SHALL grant no DELETE on Report_Cards and SHALL define no DELETE policy for them, so that every DELETE from every non-superuser role is denied.
2. THE system SHALL record the finalising user and timestamp, the reopen count, and the last reopening user and timestamp on each Report_Card.
3. THE system SHALL maintain a last-updated timestamp on each Report_Card automatically.
4. THE system SHALL preserve the existing Health_Log audit trail unchanged for logs written or amended under this feature.

### Requirement 17: Safe, additive migration

**User Story:** As a developer, I want the migration to be additive and reversible, so that applying it to production carries no risk to existing data.

#### Acceptance Criteria

1. THE Migration_Script SHALL add only: the Report_Cards table, the Editability_Model view, one nullable attribution column on `health_logs`, and their indexes, constraints, trigger and policies.
2. THE Migration_Script SHALL drop no table, remove no column and rewrite no pre-existing column other than the attribution column it adds.
3. THE Migration_Script SHALL document its own rollback.
4. THE Migration_Script SHALL state its ordering dependency on the Dietitian and Accommodation migrations.
5. THE Migration_Script SHALL provide a verification query with the expected result counts.

### Requirement 18: Closing a Retrospective_Report

**User Story:** As a dietitian, I want to close out the reports for periods that ended before this feature existed, so that my history list is not permanently full of reports I have no way of completing.

This requirement relaxes Requirement 5.3 and 5.4 for one narrowly defined class of Report_Card, and only that class.

#### Acceptance Criteria

1. THE system SHALL classify a Report_Card as a Retrospective_Report WHERE its Logging_Window end date is strictly earlier than its own creation date in IST.
2. THE system SHALL permit a Retrospective_Report to be finalised with a Report_Closing_Comment alone, without requiring its Log_Slots to be logged.
3. THE system SHALL permit a Retrospective_Report whose Logging_Window schedules no Log_Slots to be finalised.
4. THE system SHALL still require a non-empty Report_Closing_Comment for a Retrospective_Report, so that closing one is a deliberate act with a stated summary.
5. THE system SHALL state in the finalise interface that the report covers a period which predates log collection, so that the relaxed precondition is never silently applied.
6. THE system SHALL mark a Retrospective_Report as such in the history list, so an incomplete slot count is understood as historical rather than as outstanding work.
7. THE system SHALL derive Retrospective_Report classification from stored data alone, and SHALL NOT compare against a hard-coded migration date.
8. WHERE a Report_Card is created for a period that is still running or yet to end, THE system SHALL NOT classify it as a Retrospective_Report, so the relaxation cannot be reached for a live period (containment property).
9. THE system SHALL apply no other relaxation to a Retrospective_Report; its write lock, its reopen rule and its scoping SHALL behave exactly as for any other Report_Card.

## Delivery status at the time of writing

This spec was written after implementation had begun. Recorded so the design and tasks documents start from the true state rather than from zero.

| Phase | Requirements covered | State |
|---|---|---|
| 1 — schema and attribution | 1, 2.1, 2.2, 3.3, 3.4, 4, 7.1–7.3, 16, 17 | Applied to production 2026-08-04 and verified |
| 2 — read path | 2.3, 3.1, 3.2, 10, 13, 15 | Built; build, lint and tests green |
| 3 — finalise, reopen, write lock | 5, 6, 7.4, 8, 9 (partly), 11.6 | Built; 7 property tests pass; build and lint green |
| 4 — Final_Report and PDF | 11, 12, 14 | **Written but unverified and not mounted in any page** |
| 5 — retrospective close and gaps | 18, 9.4, 12.5 | Not started |

Phase 4 specifics: `getPeriodReport` and `generatePeriodReportPdf` exist in `DietitianReportService`, their actions exist, and `PeriodReportView.tsx` exists — but the component is not rendered anywhere, and no typecheck, lint, test or build has been run over the Phase 4 changes.

## Resolved decisions

1. **Historical reports could never be finished.** Requirement 5.3 demands every Log_Slot in the window be logged before a report closes. The database holds 236 Report_Cards and 4 Dietitian_Logs, and Requirement 8 plus the pre-existing same-day edit window prevent writing a log for a past date — so every backfilled report for an elapsed period would have stayed ACTIVE forever, with the history list showing all 236 as incomplete. Resolved by Requirement 18: a Retrospective_Report may be closed with a Report_Closing_Comment alone. Classification is derived from stored data (`window_end` earlier than the row's own `created_at` in IST) rather than a hard-coded migration date, so it needs no maintenance and cannot be reached for a live period.
2. **Requirement 11.1 inverts the current UI.** `ReportCardHistorySection.tsx` renders the slot strip as the primary content for a closed report with the Report_Closing_Comment beneath. Requirements 11.1 and 11.6 invert that: the Final_Report leads, the slots collapse below it. Confirmed as intended.
3. **Requirement 12.5 needs a test.** The stability property is the reason per-period adherence exists rather than reusing `CadenceService`, and it is currently unverified. Carried into the task list.
4. **Requirement 9.4 is unimplemented.** Amendment_Mode relaxes the edit window server-side but nothing tells the Dietitian why an older log became editable. Carried into the task list.
