# Flow: Report Card Lifecycle

Files: `src/app/admin/(main)/log-customer/[id]/page.tsx` (or franchise equivalent) → `src/actions/dietitian-actions/healthLogActions.ts submitHealthLog` → `src/services/HealthLogService.ts` → `health_logs` (with `report_card_id`) → `src/app/admin/(main)/customers/[id]/report-card/page.tsx` → `src/actions/dietitian-actions/reportCardLifecycleActions.ts` → `src/services/ReportCardService.ts` → view `v_report_card_editability` (`scripts/create-report-card-lifecycle.sql`) → `src/lib/dietitian/reportCardLifecycle.ts` → `DietitianReportService` + `DietitianReportTemplate.tsx` (PDF).

```mermaid
sequenceDiagram
  autonumber
  participant D as Dietitian
  participant H as healthLogActions.ts
  participant HS as HealthLogService
  participant R as reportCardLifecycleActions.ts
  participant RS as ReportCardService
  participant DB as Postgres
  D->>H: submitHealthLog(customer, date, parameters)
  H->>HS: validate (zod healthLogSchema), scope (assigned dietitian), edit window
  HS->>DB: insert health_logs (one dietitian log per customer per day) + report_card_id of ACTIVE governing record
  D->>R: getReportCardDetailAction(card)
  R->>DB: card + logs + editability view
  D->>R: finaliseReportAction(card, closingComment)
  R->>RS: all slots logged? or isRetrospectiveReport(windowEnd < createdAt)?
  RS->>DB: status CLOSED + audit fields
  D->>R: reopenReportAction(card)
  RS->>DB: only if this is the most recent CLOSED card (v_report_card_editability)
  D->>R: exportPeriodReportPdfAction(card)
  R-->>D: PDF (@react-pdf/renderer)
```

```mermaid
stateDiagram-v2
  [*] --> ACTIVE: subscription / stay exists (backfilled or created)
  ACTIVE --> CLOSED: finalise
  CLOSED --> ACTIVE: reopen (latest closed only)
```

Scope rules: dietitian must be linked (`customer_profiles.dietitian_id`), checked by `dietitian_can_read_customer()` in SQL and `scopeFranchiseCustomersForDietitian` (fail-closed) in TS.
