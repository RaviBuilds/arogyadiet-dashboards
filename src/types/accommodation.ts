/**
 * Accommodation Domain Type Definitions
 *
 * Types for the complete ACCOMMODATION customer category lifecycle:
 * stay management, health tracking, add-on services, and billing.
 *
 * Requirements: 1.1, 4.1, 9.1, 11.1
 */

/**
 * Lifecycle states of a Stay Entry
 * - PENDING: Stay booked but start date is in the future
 * - ACTIVE: Guest is currently staying (start date <= today <= end date)
 * - FINISHED: Stay completed (end date has passed)
 * - EXPIRED: Admin marked as no-show (guest never arrived)
 */
export type StayStatus = "PENDING" | "ACTIVE" | "FINISHED" | "EXPIRED";

/**
 * Accommodation type options
 * - AC Villa: Air-conditioned villa accommodation
 * - Village Style Hut: Traditional village-style hut accommodation
 */
export type StayType = "AC Villa" | "Village Style Hut";

/**
 * Room occupancy configuration
 * - Single: Single occupancy
 * - Double: Double occupancy
 */
export type OccupancyType = "Single" | "Double";

/**
 * Meal preference for accommodation guests
 */
export type MealPreference = "VEG" | "EGG" | "CHICKEN";

/**
 * Status of an add-on wellness service request
 * - PENDING: Request submitted, awaiting confirmation
 * - CONFIRMED: Request confirmed by admin
 * - COMPLETED: Service has been delivered
 * - CANCELLED: Customer withdrew the request before it was completed
 */
export type AddonServiceStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED";

/** Add-on request statuses that count as "open" — block a new request for
 *  the same customer until they resolve to COMPLETED or CANCELLED. */
export const OPEN_ADDON_SERVICE_STATUSES: readonly AddonServiceStatus[] = [
  "PENDING",
  "CONFIRMED",
];

/**
 * A single accommodation booking record representing one continuous stay period.
 * Central domain entity decoupled from meal subscriptions.
 *
 * `paymentAmount` is the stay's Total_Stay_Amount (GST inclusive). Total_Paid and
 * Remaining_Balance are never stored — they are always derived from the
 * Payment_Transaction ledger (see {@link StayPaymentTransaction}).
 *
 * Requirements: 6.3, 8.4, 12.15
 */
export interface StayEntry {
  id: string;
  customerProfileId: string;
  startDate: string; // ISO date (YYYY-MM-DD)
  totalNights: number;
  stayType: StayType;
  occupancyType: OccupancyType;
  status: StayStatus;
  paymentAmount: number | null;
  baseAmount: number | null;
  taxAmount: number | null;
  taxPercentage: number;
  paymentHostProfileId: string | null;
  mealPreference: MealPreference;
  endDate: string; // computed: startDate + totalNights - 1
  createdAt: string;
  updatedAt: string;

  /** True when the stay was onboarded with a past start date (Backdated_Stay). */
  isBackdated: boolean;
  /**
   * Retained with a narrowed meaning: true when the stay **ended earlier than
   * originally booked** — i.e. a Save_Stay_Details submission shortened it.
   * It is no longer the "figures were recalculated" signal (that is
   * {@link StayEntry.recalculationApplied}) and no gate reads it, because an
   * amount-only correction leaves the stay length untouched.
   */
  earlyCheckoutApplied: boolean;
  /**
   * Nights actually stayed. Still kept in sync with `totalNights` whenever
   * `earlyCheckoutApplied` is set, so historical rows and
   * `chk_stay_actual_nights` stay coherent.
   *
   * @deprecated Never read — Save_Stay_Details is repeatable, so this can go
   * stale between invocations. Use {@link StayEntry.totalNights}.
   */
  actualNightsStayed: number | null;
  /** Booked nights before the FIRST Save_Stay_Details; pinned on first application only. */
  originalTotalNights: number | null;
  /** Total_Stay_Amount before the FIRST Save_Stay_Details; pinned on first application only. */
  originalTotalAmount: number | null;
  /**
   * True once Save_Stay_Details has been applied at least once. This — not
   * `earlyCheckoutApplied` — is what "the figures were recalculated" means.
   *
   * Requirements: 8.4
   */
  recalculationApplied: boolean;
  /** Timestamp the stay was finalised through checkout. */
  checkedOutAt: string | null;
  /** `payments.id` of the single Final_Consolidated_Invoice for this stay. */
  finalInvoicePaymentId: string | null;
  /** Timestamp the Final_Consolidated_Invoice was generated. */
  finalInvoiceGeneratedAt: string | null;
  /** Last invoice generation failure message; drives the retry affordance. */
  finalInvoiceError: string | null;
}

/**
 * Daily health data entered by the customer.
 * Tracks water intake and physical activity during the stay.
 * Upserted on conflict (stay_entry_id + log_date) — one entry per day per stay.
 */
export interface CustomerHealthLog {
  id: string;
  stayEntryId: string;
  logDate: string;
  waterIntakeLiters: number;
  activityName: string | null;
  activityDurationMinutes: number | null;
  createdAt: string;
}

/**
 * Daily health monitoring data entered by the admin.
 * Tracks weight, blood pressure, sugar level, and notes during checkups.
 */
export interface AdminHealthLog {
  id: string;
  stayEntryId: string;
  logDate: string;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  sugarLevelMgdl: number | null;
  notes: string | null;
  createdAt: string;
}

/**
 * A request for an additional wellness service (therapy, massage, etc.)
 * submitted by an accommodation customer during their stay.
 */
export interface AddonServiceRequest {
  id: string;
  customerProfileId: string;
  stayEntryId: string;
  serviceType: string;
  status: AddonServiceStatus;
  requestedAt: string;
}
/**
 * Kind of Payment_Transaction recorded against a stay.
 * - ADVANCE: the one-off advance captured at onboarding (at most one per stay)
 * - PARTIAL_BALANCE_PAYMENT: any later collection against the remaining balance
 * - REFUND: money returned to the guest (reduces Total_Paid)
 *
 * Requirements: 6.2, 12.11
 */
export type PaymentTransactionType =
  | "ADVANCE"
  | "PARTIAL_BALANCE_PAYMENT"
  | "REFUND";

/**
 * Display labels for each Payment_Transaction type.
 * Used by the payment history list and the Payment_Receipt document.
 *
 * Requirements: 6.2, 10.2
 */
export const PAYMENT_TRANSACTION_LABELS: Record<PaymentTransactionType, string> =
  {
    ADVANCE: "Advance",
    PARTIAL_BALANCE_PAYMENT: "Partial / Balance Payment",
    REFUND: "Refund",
  };

/**
 * A single append-only entry in a stay's Payment_Transaction ledger.
 * The ledger is the sole source of truth for Total_Paid and Remaining_Balance.
 *
 * Requirements: 6.1, 6.2, 6.5
 */
export interface StayPaymentTransaction {
  id: string;
  stayEntryId: string;
  customerProfileId: string;
  transactionType: PaymentTransactionType;
  amount: number;
  transactionDate: string; // ISO date (YYYY-MM-DD, IST)
  comment: string | null;
  remark: string | null;
  createdBy: string | null;
  createdAt: string;
  /**
   * `payments.id` of this REFUND row's Refund_Invoice, mirroring
   * `stay_payment_transactions.refund_invoice_payment_id`. Null for every
   * non-REFUND row; written by `record_stay_refund_with_invoice()` in the same
   * transaction as the ledger row, so a Refund_Invoice can never be orphaned.
   *
   * Requirements: 14.7
   */
  refundInvoicePaymentId?: string | null;
}

/**
 * Derived money position of a stay. Never persisted — recomputed from the
 * Total_Stay_Amount and the ledger on every read.
 *
 * Requirements: 6.3, 6.4, 6.7
 */
export interface StayBalanceSnapshot {
  totalStayAmount: number;
  totalPaid: number;
  /** May be negative when Total_Paid exceeds Total_Stay_Amount (refund pending). */
  remainingBalance: number;
  /** True only when remainingBalance is exactly zero (compared in paise). */
  isFullyPaid: boolean;
  /** max(0, -remainingBalance) */
  refundDue: number;
}

/**
 * A single recorded Stay_Extension. Purely informational — has no bearing on
 * Total_Paid or Remaining_Balance, which continue to be derived exclusively
 * from `StayPaymentTransaction`. See `scripts/create-stay-extension-history.sql`.
 */
export interface StayExtension {
  id: string;
  stayEntryId: string;
  customerProfileId: string;
  additionalNights: number;
  additionalAmount: number;
  nightsBefore: number;
  nightsAfter: number;
  totalAmountBefore: number | null;
  totalAmountAfter: number;
  extendedOn: string; // ISO date (YYYY-MM-DD, IST)
  createdAt: string;
}

/**
 * One recorded Save_Stay_Details submission that actually changed something.
 * Purely informational, exactly like {@link StayExtension} — nothing derives a
 * balance, a night count, or an end date from it. Never mixed with extension
 * history in either direction. See `scripts/create-stay-recalculation.sql`.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.5
 */
export interface StayRecalculation {
  id: string;
  stayEntryId: string;
  customerProfileId: string;
  nightsBefore: number;
  nightsAfter: number;
  totalAmountBefore: number | null;
  totalAmountAfter: number;
  /** Computed_End_Date immediately before this submission. */
  endDateBefore: string; // ISO date (YYYY-MM-DD)
  /** Recalculated_End_Date this submission applied. */
  endDateAfter: string; // ISO date (YYYY-MM-DD)
  recalculatedOn: string; // ISO date (YYYY-MM-DD, IST)
  createdAt: string;
}

/**
 * Which payment and checkout affordances the Accommodation tab may render for a stay.
 * `showMarkCheckedOut` and `showGenerateFinalInvoice` are disjoint by construction.
 *
 * Requirements: 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1, 12.10, 14.1
 */
export interface StayActionVisibility {
  showRecordPayment: boolean;
  showFullyPaidMessage: boolean;
  showMarkCheckedOut: boolean;
  markCheckedOutEnabled: boolean;
  /**
   * Why Mark as Checked Out is visible but disabled, so the UI can explain the
   * block rather than leaving a dead button. `null` when it is enabled (or not
   * shown at all). Balance is reported ahead of the date when both apply,
   * because collecting money is the action the admin can take today.
   */
  markCheckedOutBlockedReason: "BALANCE_OUTSTANDING" | "BEFORE_END_DATE" | null;
  showGenerateFinalInvoice: boolean;
  /**
   * Recalculate_Stay. ACTIVE and billable — never suppressed after a first use,
   * because recalculation is repeatable (Req 12.1, 12.10).
   */
  showRecalculateStay: boolean;
  /**
   * Mark_As_Refunded. Standalone rather than a recalculation branch: derived
   * from the balance (ACTIVE, billable, `refundDue > 0`), so it survives a
   * reload and stays true until the refund is recorded (Req 14.1).
   */
  showMarkAsRefunded: boolean;
}

/**
 * Everything the Accommodation tab needs for one stay in a single read:
 * the stay, its chronological ledger, the derived balance, and the action gating.
 *
 * Requirements: 6.5, 6.6, 8.1, 13.3, 13.5
 */
export interface StayLedgerView {
  stay: StayEntry;
  transactions: StayPaymentTransaction[]; // chronological
  /** Every Stay_Extension applied to this stay, chronological. Informational only. */
  extensions: StayExtension[];
  /**
   * Every recorded Save_Stay_Details submission, ascending by recorded date —
   * oldest first. Informational only, and never sourced from `extensions`
   * (Req 13.3, 13.5, 13.6, 13.7).
   */
  recalculations: StayRecalculation[];
  balance: StayBalanceSnapshot;
  hasFinalInvoice: boolean;
  visibility: StayActionVisibility;
}

/**
 * Data backing the printable per-transaction Payment_Receipt.
 *
 * Requirements: 10.1, 10.2
 */
export interface PaymentReceiptData {
  receiptNumber: string; // RCPT-<first uuid segment, uppercased>
  transaction: StayPaymentTransaction;
  typeLabel: string; // from PAYMENT_TRANSACTION_LABELS
  customerName: string;
  customerMobile: string;
  stayType: StayType;
  stayDates: { startDate: string; endDate: string };
}

/**
 * Result of a Save_Stay_Details submission against an ACTIVE stay: the
 * recalculated nights and amount, the new balance, and exactly one money
 * follow-up. REPLACES the retired `EarlyCheckoutOutcome`.
 *
 * Two structural differences carry Req 12.9:
 *  - there is no `CHECKED_OUT` member and no `invoiceStatus` field, so no value
 *    of this type can express "and the stay was also checked out";
 *  - `status` is the literal `"ACTIVE"`, making the invariant checkable at the
 *    type level as well as at runtime.
 *
 * Requirements: 12.8, 12.9, 12.11, 12.12, 12.15, 13.2
 */
export type SaveStayDetailsOutcome = {
  stayId: string;
  /** Recalculated_Total_Nights, DERIVED from the submitted end date. */
  totalNights: number;
  /** Recalculated_End_Date, echoed back so the tab can re-render without a refetch. */
  recalculatedEndDate: string; // ISO date (YYYY-MM-DD)
  /** Recalculated_Stay_Amount, now the stay's Total_Stay_Amount. */
  totalStayAmount: number;
  balance: StayBalanceSnapshot;
  /** Which money follow-up (if any) the tab must present. Never a checkout. */
  nextAction: "COLLECT_BALANCE" | "RECORD_REFUND" | "SETTLED";
  /** 0 unless nextAction === "RECORD_REFUND" */
  refundDue: number;
  /** false for a no-op submission — no Recalculation_History entry was written (Req 13.2). */
  historyRecorded: boolean;
  /** Always "ACTIVE": Save_Stay_Details never transitions status (Req 12.9). */
  status: "ACTIVE";
};

/**
 * A single row in the extension history list displayed on the Accommodation
 * tab, below Payment History. Produced by `buildExtensionHistoryRows` —
 * sorted by (extendedOn, createdAt) non-decreasing.
 */
export interface ExtensionHistoryRow {
  /** The Stay_Extension record's id. */
  id: string;
  /** Formatted extension date for display (YYYY-MM-DD). */
  date: string;
  /** Nights added by this extension. */
  additionalNights: number;
  /** Amount folded into Total_Stay_Amount by this extension. */
  additionalAmount: number;
  /** Total nights immediately before this extension. */
  nightsBefore: number;
  /** Total nights immediately after this extension. */
  nightsAfter: number;
  /** Total_Stay_Amount immediately after this extension. */
  totalAmountAfter: number;
}

/**
 * A single row in the dedicated Recalculation History card displayed on the
 * Accommodation tab, beside the Extension History card. Produced by
 * `buildRecalculationHistoryRows` — sorted ascending by (recalculatedOn,
 * createdAt), oldest first. An empty list is the Req 13.4 empty state.
 *
 * Requirements: 13.4, 13.5
 */
export interface RecalculationHistoryRow {
  /** The Recalculation_History record's id. */
  id: string;
  /** Formatted recalculation date for display (YYYY-MM-DD). */
  date: string;
  /** Total nights immediately before this submission. */
  nightsBefore: number;
  /** Total nights immediately after this submission. */
  nightsAfter: number;
  /** Total_Stay_Amount immediately before this submission. */
  totalAmountBefore: number | null;
  /** Total_Stay_Amount immediately after this submission. */
  totalAmountAfter: number;
  /** Computed_End_Date immediately before this submission. */
  endDateBefore: string;
  /** Computed_End_Date immediately after this submission. */
  endDateAfter: string;
}

/**
 * A single row in the payment history list displayed on the Accommodation tab.
 * Produced by `buildPaymentHistoryRows` — sorted by (transactionDate, createdAt)
 * non-decreasing.
 *
 * Requirements: 6.2, 6.5, 10.2, 10.3
 */
export interface PaymentHistoryRow {
  /** The Payment_Transaction id. */
  id: string;
  /** Formatted transaction date for display (YYYY-MM-DD). */
  date: string;
  /** Transaction amount. */
  amount: number;
  /** Human-readable type label from PAYMENT_TRANSACTION_LABELS. */
  typeLabel: string;
  /** Admin comment (may be null). */
  comment: string | null;
  /** Admin remark (may be null). */
  remark: string | null;
  /** Route path to the payment receipt for this transaction. */
  receiptLinkTarget: string;
}
