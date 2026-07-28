// src/lib/dietitian/messages.ts
// The single definition of every user-visible string the Dietitian feature
// pins in its requirements. Validation schemas, services, Server Actions, the
// UI and the tests all import from here so a message can never drift between
// the layer that raises it and the layer that asserts it.
//
// Requirements validated: 2.4, 2.5, 2.6, 2.11, 4.4, 5.9, 6.4, 7.2, 7.5, 7.8,
// 8.3, 11.11, 12.4, 12.5, 13.2, 15.7, 15.8, 15.13, 18.2, 18.3, 18.4, 19.8,
// 20.7, 22.4, 24.4

// ─── Dietitian account provisioning ──────────────────────────────────────────

/** Empty Mobile number on a Dietitian submission — reported before the digit check (Req 2.4). */
export const MOBILE_REQUIRED_FOR_DIETITIAN =
  "Mobile number is required for a dietitian" as const;

/** Mobile number that is not exactly 10 digits (Req 2.5). */
export const MOBILE_MUST_BE_TEN_DIGITS = "Enter a 10-digit mobile number" as const;

/** Mapped from the `users_mobile_key` unique violation (Req 2.6). */
export const MOBILE_ALREADY_REGISTERED =
  "This mobile number is already registered" as const;

/**
 * Mapped from the `users_one_active_dietitian_per_franchise` partial unique
 * index, and returned by the application-layer cardinality check
 * (Req 2.11, 3.7, 10.4).
 */
export const FRANCHISE_ALREADY_HAS_DIETITIAN =
  "This franchise already has a dietitian" as const;

/** Create Dietitian is unavailable until the Franchise has a Clinic (Req 22.4). */
export const WIRE_CLINIC_TO_FRANCHISE_FIRST =
  "Wire a clinic to this franchise first" as const;

// ─── Scope and assignment ────────────────────────────────────────────────────

/** Shown in the Dietitian Customers workspace when the Dietitian_Clinic_Link is empty (Req 4.4). */
export const NO_CLINIC_ASSIGNED_NOTICE =
  "No clinic assigned. Contact the master admin." as const;

/** Returned by `checkDietitianScope` on a scope miss (Req 5.9). */
export const CUSTOMER_NOT_IN_SCOPE = "Customer is not in your scope" as const;

/** A Dietitian_Link that points at a non-Dietitian `users` row (Req 6.4). */
export const SELECTED_USER_IS_NOT_A_DIETITIAN =
  "Selected user is not a dietitian" as const;

/** Placeholder while the onboarding address step has not resolved a Clinic (Req 7.2). */
export const COMPLETE_ADDRESS_TO_LOAD_DIETITIANS =
  "Complete the address to load dietitians" as const;

/** The resolved Clinic has no active Dietitian; onboarding may still continue (Req 7.5). */
export const NO_DIETITIAN_FOR_CLINIC =
  "No dietitian is assigned to this clinic" as const;

/** Submitted Dietitian is not linked to the resolved Clinic (Req 7.8). */
export const DIETITIAN_NOT_IN_RESOLVED_CLINIC =
  "Selected dietitian does not belong to the resolved clinic" as const;

/** Placeholder for the Customer_360 Dietitian dropdown with no assigned Clinic (Req 8.3). */
export const ASSIGN_A_CLINIC_FIRST = "Assign a clinic first" as const;

// ─── Health_Log capture ──────────────────────────────────────────────────────

/** The Closing_Comment is mandatory on every submission (Req 13.2). */
export const CLOSING_COMMENT_REQUIRED = "A closing comment is required" as const;

/** An empty Custom_Parameter label (Req 12.4). */
export const CUSTOM_PARAMETER_LABEL_REQUIRED =
  "Custom parameter label is required" as const;

/** Two Custom_Parameters sharing a label after trimming and case folding (Req 12.5). */
export const CUSTOM_PARAMETER_LABELS_MUST_BE_UNIQUE =
  "Custom parameter labels must be unique" as const;

/** A `log_date` after the current IST calendar date (Req 15.7). */
export const LOG_DATE_IN_FUTURE = "Log date cannot be in the future" as const;

/** The selected date is a Paused_Day for the governing subscription (Req 15.8). */
export const LOG_DATE_IS_PAUSED =
  "The selected date is paused for this customer" as const;

/** The author of a Health_Log could not be resolved (Req 15.13). */
export const AUTHOR_NOT_IDENTIFIED =
  "Could not identify the author of this log" as const;

/** The same-day edit window has closed (Req 18.2). */
export const LOG_NO_LONGER_EDITABLE = "This log can no longer be edited" as const;

/** A Dietitian attempted to edit a Health_Log authored by somebody else (Req 18.3). */
export const CAN_ONLY_EDIT_OWN_LOGS = "You can only edit your own logs" as const;

/** Health_Logs are append-only; deletion is refused at every layer (Req 18.4). */
export const HEALTH_LOGS_CANNOT_BE_DELETED =
  "Health logs cannot be deleted" as const;

// ─── Reporting empty states ──────────────────────────────────────────────────

/** Report_Card for a customer with no Health_Log; PDF export stays disabled (Req 19.8). */
export const NO_HEALTH_LOGS_RECORDED = "No health logs recorded yet" as const;

/** Dietitian_Activity_Report for a Dietitian with no linked Customer_Records (Req 20.7). */
export const NO_CUSTOMERS_FOR_DIETITIAN =
  "No customers are assigned to this dietitian" as const;

/** Franchise Dietitian Activity page when the Franchise has no Dietitian (Req 24.4). */
export const NO_DIETITIAN_FOR_FRANCHISE =
  "No dietitian is assigned to this franchise" as const;

// ─── Out-of-range parameter messages ─────────────────────────────────────────

/**
 * The shape the range message is generated from — satisfied by every bounded
 * entry of the Health_Log field table.
 */
export interface RangeMessageInput {
  /** The UI label of the parameter, e.g. `Weight`. */
  label: string;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** The parameter's unit, e.g. `kg`. Omitted for unitless parameters. */
  unit?: string;
}

/**
 * Renders the out-of-range message pinned by Req 11.11 as
 * `{label} must be between {min} and {max} {unit}`.
 *
 * A missing, empty or whitespace-only unit yields `{label} must be between
 * {min} and {max}` with no trailing space, so a unitless bounded parameter
 * still reads correctly.
 */
export function outOfRangeMessage({ label, min, max, unit }: RangeMessageInput): string {
  const base = `${label} must be between ${min} and ${max}`;
  const trimmedUnit = unit?.trim() ?? "";
  return trimmedUnit ? `${base} ${trimmedUnit}` : base;
}

/** Every pinned string, keyed by name, for exhaustive test coverage. */
export const DIETITIAN_MESSAGES = {
  MOBILE_REQUIRED_FOR_DIETITIAN,
  MOBILE_MUST_BE_TEN_DIGITS,
  MOBILE_ALREADY_REGISTERED,
  FRANCHISE_ALREADY_HAS_DIETITIAN,
  WIRE_CLINIC_TO_FRANCHISE_FIRST,
  NO_CLINIC_ASSIGNED_NOTICE,
  CUSTOMER_NOT_IN_SCOPE,
  SELECTED_USER_IS_NOT_A_DIETITIAN,
  COMPLETE_ADDRESS_TO_LOAD_DIETITIANS,
  NO_DIETITIAN_FOR_CLINIC,
  DIETITIAN_NOT_IN_RESOLVED_CLINIC,
  ASSIGN_A_CLINIC_FIRST,
  CLOSING_COMMENT_REQUIRED,
  CUSTOM_PARAMETER_LABEL_REQUIRED,
  CUSTOM_PARAMETER_LABELS_MUST_BE_UNIQUE,
  LOG_DATE_IN_FUTURE,
  LOG_DATE_IS_PAUSED,
  AUTHOR_NOT_IDENTIFIED,
  LOG_NO_LONGER_EDITABLE,
  CAN_ONLY_EDIT_OWN_LOGS,
  HEALTH_LOGS_CANNOT_BE_DELETED,
  NO_HEALTH_LOGS_RECORDED,
  NO_CUSTOMERS_FOR_DIETITIAN,
  NO_DIETITIAN_FOR_FRANCHISE,
} as const;

/** The name of one of the pinned Dietitian messages. */
export type DietitianMessageKey = keyof typeof DIETITIAN_MESSAGES;
