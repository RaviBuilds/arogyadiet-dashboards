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
