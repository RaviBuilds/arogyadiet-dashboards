// src/types/dietitian.ts
// TypeScript interfaces for the Dietitian domain (dietitian-management).
//
// A Dietitian is a `users` row whose `admin_access_level` is `dietitian` and
// whose role is `ADMIN` (Core_Business) or `FRANCHISE_ADMIN` (Franchise). The
// Dietitian_Clinic_Link lives on `users.dietitian_clinic_id` (0..1 per
// Dietitian) and the Dietitian_Link lives on `customer_profiles.dietitian_id`
// (0..1 per Customer_Record).
//
// Domain-shape types (camelCase) are declared here so the pure modules in
// `src/lib/dietitian/*`, the Zod schemas, the repositories, the services and the
// shared components all agree on one definition. Rows read straight out of
// Supabase keep their snake_case shape inside the repository layer.
//
// Requirements: 6.1, 11.12, 12.2, 15.12, 18.5

/**
 * The value of `subscriptions.customer_category` for a customer's governing
 * subscription. Drives the Cadence_Interval (1 day for `ACCOMMODATION`, 3 days
 * for `MEAL` and `KIT`) and the Health_Log field set (28 parameters for
 * `ACCOMMODATION`, 22 for `MEAL`/`KIT`).
 */
export type CustomerCategory = "MEAL" | "KIT" | "ACCOMMODATION";

/**
 * A Dietitian account as rendered by the Master_Portal Dietitians section,
 * joined with the assigned Clinic and its owning Franchise.
 *
 * `clinicId`/`clinicName` are `null` when the Dietitian_Clinic_Link is empty —
 * the Master_Portal renders that as `Unassigned` (Req 3.4). `franchiseId` is
 * `null` for a Core_Business Dietitian (Req 2.9).
 */
export interface DietitianAccount {
  id: string; // users.id
  authUserId: string;
  fullName: string;
  email: string;
  mobile: string; // exactly 10 digits (Req 2.7)
  roleCode: "ADMIN" | "FRANCHISE_ADMIN";
  clinicId: string | null;
  clinicName: string | null;
  franchiseId: string | null;
  franchiseName: string | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * An operator-defined health metric captured as a label / value / unit triple
 * and stored on a Health_Log without a schema change (Req 12.1–12.3).
 *
 * `unit` may be the empty string (0 to 20 characters); `label` is 1 to 60
 * characters and `value` 1 to 200 characters after trimming.
 */
export interface CustomParameter {
  label: string;
  value: string;
  unit: string;
}

/**
 * A single recorded parameter value inside a Health_Log's sparse `parameters`
 * map. An absent key means the Dietitian entered no value for that parameter,
 * which is also why no unit is stored for an empty parameter (Req 11.12, 11.13).
 *
 * The four members mirror the four value-carrying `FieldKind`s:
 * - `number` — numeric value plus its unit (`null` for a unitless number)
 * - `boolean` — Yes/No parameters
 * - `string` — `enum` and `text` parameters
 * - systolic/diastolic — the composite `bp` parameter
 */
export type ParameterValue =
  | { value: number; unit: string | null }
  | { value: boolean }
  | { value: string }
  | { systolic: number; diastolic: number; unit: "mmHg" };

/**
 * A dated record of health measurements for one Customer_Record, authored
 * either by a Dietitian (Dietitian_Log) or by the customer (Self_Log).
 *
 * Rows come from the `v_health_log_timeline` union view, so `source` names the
 * underlying table: `health_logs` for Dietitian_Logs written by this feature,
 * and the three untouched legacy tables for existing data (Req 26.4).
 */
export interface HealthLog {
  id: string;
  customerProfileId: string;
  /** IST calendar date the log applies to, YYYY-MM-DD. */
  logDate: string;
  authorType: "DIETITIAN" | "CUSTOMER";
  authorUserId: string | null;
  authorName: string | null;
  category: CustomerCategory;
  /** Sparse map keyed by `FieldDefinition.key` — an absent key means no value. */
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  closingComment: string | null;
  /** Submission timestamp (ISO 8601). */
  submittedAt: string;
  /** IST calendar date of submission, YYYY-MM-DD (Req 15.12). */
  submissionDateIst: string;
  source:
    | "health_logs"
    | "admin_health_logs"
    | "customer_health_logs"
    | "kit_daily_logs";
}

/**
 * An append-only Log_Audit_Trail entry. One entry is written for every
 * Health_Log write attempt, accepted **and** rejected (Req 18.5, 18.6).
 *
 * `healthLogId` is `null` when the attempt was rejected before a Health_Log
 * existed; `rejectionReason` carries the returned message for a `REJECTED`
 * outcome and is `null` otherwise.
 */
export interface AuditEntry {
  id: string;
  healthLogId: string | null;
  customerProfileId: string;
  logDate: string;
  actorUserId: string | null;
  actorName: string | null;
  action: "CREATE" | "UPDATE" | "DELETE";
  outcome: "ACCEPTED" | "REJECTED";
  rejectionReason: string | null;
  changedValues: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * One row of the Dietitian customer list, carrying the cadence values computed
 * by the Cadence_Engine plus the Self_Log adherence counts.
 *
 * `lastDietitianLogDate` is `null` when the customer has no Dietitian_Log; the
 * list sorts that as the earliest orderable value in both directions (Req 17.6).
 * The Self_Log counts are zero for `MEAL` and `ACCOMMODATION`, which have no
 * Self_Log capture.
 */
export interface DietitianCustomerRow {
  customerProfileId: string;
  customerCode: string | null;
  name: string;
  mobile: string | null;
  category: CustomerCategory;
  assignedDietitianName: string | null;
  lastDietitianLogDate: string | null;
  daysNotLogged: number;
  pendingLogCount: number;
  pausedDaysCount: number;
  skippedSelfLogCount: number;
  datesWithoutSelfLogCount: number;
}

/**
 * The aggregated Dietitian_Activity_Report shown on the Master dashboard and on
 * the Franchise Owner activity page. Both surfaces read the same shape from the
 * same Cadence_Engine, so their numbers agree by construction (Req 24.6).
 *
 * `rows` is the per-customer table the three headline counts are derived from.
 */
export interface DietitianActivitySummary {
  dietitianUserId: string;
  dietitianName: string;
  clinicName: string | null;
  customersWithPendingLogs: number;
  maxDaysNotLogged: number;
  customersMissingSelfLog: number;
  rows: DietitianCustomerRow[];
}

// ---------------------------------------------------------------------------
// Report_Card lifecycle (report-card-lifecycle, Phase 1)
// ---------------------------------------------------------------------------

/**
 * Which record a Report_Card covers. MEAL and KIT report on a `subscriptions`
 * row; ACCOMMODATION reports on a `stay_entries` row, so a Stay_Extension folds
 * into the same report rather than starting a new one.
 */
export type ReportCardSubjectType = "SUBSCRIPTION" | "STAY";

/**
 * A Report_Card's lifecycle state.
 * - `ACTIVE` — still being filled in; its logs are writable.
 * - `CLOSED` — finalised with a report-level Closing_Comment.
 *
 * A customer may hold several `ACTIVE` report cards at once: an unfinished older
 * subscription's report coexists with the current one, so the Dietitian can go
 * back and complete it.
 */
export type ReportCardStatus = "ACTIVE" | "CLOSED";

/**
 * One closable Report_Card, covering exactly one subscription or one stay.
 *
 * `reportClosingComment` is the REPORT-level closing statement written at
 * finalisation — distinct from {@link HealthLog.closingComment}, which is a
 * mandatory per-day note on every individual log.
 *
 * `windowStart` / `windowEnd` snapshot the Logging_Window. They are refreshed
 * while the report is ACTIVE (a Stay_Extension moves `windowEnd`) and frozen at
 * finalisation, so a closed report always states the period it actually covered.
 */
export interface ReportCard {
  id: string;
  customerProfileId: string;
  subjectType: ReportCardSubjectType;
  /** Set iff `subjectType === "SUBSCRIPTION"`. */
  subscriptionId: string | null;
  /** Set iff `subjectType === "STAY"`. */
  stayEntryId: string | null;
  category: CustomerCategory;
  windowStart: string;
  windowEnd: string;
  status: ReportCardStatus;
  reportClosingComment: string | null;
  finalisedAt: string | null;
  finalisedBy: string | null;
  reopenCount: number;
  lastReopenedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * True when this report's Logging_Window had already ended before the report
   * itself existed, so its Log_Slots could never have been logged on their
   * deadline dates.
   *
   * Derived by `isRetrospectiveReport` in `src/lib/dietitian/reportCardLifecycle.ts`
   * from `windowEnd` and `createdAt` — never stored, and never compared against a
   * hard-coded migration date. Such a report may be finalised on its
   * Report_Closing_Comment alone; every other rule (write lock, reopen
   * eligibility, scoping) applies to it unchanged.
   */
  isRetrospective: boolean;
}

/**
 * A Report_Card plus the derived lock flags read from
 * `v_report_card_editability` — the single source of truth for the lock rule.
 *
 * - `isEditable` — the report's logs may still be written. True for every
 *   `ACTIVE` report and for the one most-recently-CLOSED report.
 * - `isReopenable` — true only for that most-recently-CLOSED report.
 *
 * Every CLOSED report older than the most recent one is permanently locked for
 * everyone. Closing the current report shifts the window forward: the newly
 * closed report becomes reopenable and the previous one locks for good.
 */
export interface ReportCardWithEditability extends ReportCard {
  isEditable: boolean;
  isReopenable: boolean;
}

/**
 * One entry in a customer's Report_Card history: the report card, its lock
 * flags, and the slot progress that decides whether it can be finalised.
 *
 * Declared here rather than in `ReportCardService` because client components
 * render it. A service module pulls `createAdminClient` (and therefore the
 * service-role key) into its module graph, so a `"use client"` file must not
 * depend on one even for types — the same reason `paymentHistory.ts` and
 * `backdatedStay.ts` were extracted into `src/lib/`.
 */
export interface ReportCardHistoryEntry {
  reportCard: ReportCardWithEditability;
  /** Total Log_Slots in this report's Logging_Window. */
  totalSlots: number;
  /** Slots that already carry a Dietitian_Log. */
  loggedSlots: number;
  /**
   * True when every slot in the window is logged — the precondition for
   * finalising the report with its Closing_Comment. A window with no slots at
   * all is NOT completable, since there would be nothing to report on.
   */
  isComplete: boolean;
  /** True when this report covers the customer's currently-governing record. */
  isCurrent: boolean;
}

/** A customer's full Report_Card history, newest period first. */
export interface ReportCardHistory {
  customerProfileId: string;
  category: CustomerCategory;
  entries: ReportCardHistoryEntry[];
}
/**
 * Progress of one Report_Card's Log_Slots. Paired with `ReportCardWithEditability`
 * and a `LogSlot[]` by the client-facing detail payload.
 *
 * Kept free of any `LogSlot` reference on purpose: `@/lib/dietitian/logSlots`
 * already imports `CustomerCategory` from this module, so naming `LogSlot` here
 * would close a type-only import cycle. The Server Action composes the two
 * instead.
 */
export interface ReportCardProgress {
  totalSlots: number;
  loggedSlots: number;
  isComplete: boolean;
}
