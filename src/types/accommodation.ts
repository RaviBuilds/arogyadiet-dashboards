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
 * Requirements: 6.3, 12.6, 12.15
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
  /** True once an Early_Checkout recalculation has been applied to this stay. */
  earlyCheckoutApplied: boolean;
  /** Nights actually stayed; set only by Early_Checkout. */
  actualNightsStayed: number | null;
  /** Booked nights before the first Early_Checkout; preserved on first application only. */
  originalTotalNights: number | null;
  /** Total_Stay_Amount before the first Early_Checkout; preserved on first application only. */
  originalTotalAmount: number | null;
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
 * Which payment and checkout affordances the Accommodation tab may render for a stay.
 * `showMarkCheckedOut` and `showGenerateFinalInvoice` are disjoint by construction.
 *
 * Requirements: 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1
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
  showEarlyCheckout: boolean;
}

/**
 * Everything the Accommodation tab needs for one stay in a single read:
 * the stay, its chronological ledger, the derived balance, and the action gating.
 *
 * Requirements: 6.5, 6.6, 8.1
 */
export interface StayLedgerView {
  stay: StayEntry;
  transactions: StayPaymentTransaction[]; // chronological
  /** Every Stay_Extension applied to this stay, chronological. Informational only. */
  extensions: StayExtension[];
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
 * Result of applying an Early_Checkout to an ACTIVE stay: the recalculated
 * nights and amount, the new balance, and exactly one follow-up step.
 *
 * Requirements: 12.6, 12.7, 12.12, 12.13, 12.15
 */
export type EarlyCheckoutOutcome = {
  stayId: string;
  totalNights: number; // = actualNightsStayed
  totalStayAmount: number; // = recalculatedStayAmount
  balance: StayBalanceSnapshot;
  /** Which follow-up the Accommodation tab must present. */
  nextStep: "COLLECT_BALANCE" | "RECORD_REFUND" | "CHECKED_OUT";
  /** 0 unless nextStep === "RECORD_REFUND" */
  refundDue: number;
  invoiceStatus?: "GENERATED" | "PENDING_RETRY";
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
