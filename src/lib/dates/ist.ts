/** Shown in rider empty states when daily routes are not yet available. */
export const ROUTE_GENERATION_LABEL = "12:10 AM";

/** From 5:00 PM IST, rider UI targets the next calendar day's delivery_date. */
export const RIDER_DAY_ROLLOVER_HOUR_IST = 17;

/** Returns hour 0–23 in Asia/Kolkata (IST). */
export function getISTHour(): number {
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  return Number(hourStr);
}

/** True between 5:00 PM and midnight IST (evening preview of next batch). */
export function isRiderEveningPreviewIST(): boolean {
  return getISTHour() >= RIDER_DAY_ROLLOVER_HOUR_IST;
}

/** delivery_date filter for rider queries and batch actions (IST operational day). */
export function getRiderOperationalDeliveryDate(): string {
  return isRiderEveningPreviewIST()
    ? getISTDateString(1)
    : getISTDateString(0);
}

export function getRiderRouteHeading(): "Today's Route" | "Tomorrow's Route" {
  return isRiderEveningPreviewIST() ? "Tomorrow's Route" : "Today's Route";
}

export function getRiderOverviewHeading():
  | "Today's Overview"
  | "Tomorrow's Overview" {
  return isRiderEveningPreviewIST()
    ? "Tomorrow's Overview"
    : "Today's Overview";
}

/** Returns YYYY-MM-DD in Asia/Kolkata (IST), optionally offset by whole days. */
export function getISTDateString(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getTomorrowISTDateString(): string {
  return getISTDateString(1);
}

/** Parses YYYY-MM-DD into a Date at local midnight for calendar use. */
export function parseISODateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Expected kitchen departure for morning delivery runs (IST wall-clock). */
export const DEFAULT_RIDER_DEPARTURE_TIME_IST = "05:00:00";

/** Builds an RFC 3339 timestamp for Routes API departureTime on a delivery date. */
export function buildISTDepartureISO(
  targetDate: string,
  time = DEFAULT_RIDER_DEPARTURE_TIME_IST,
): string {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return `${targetDate}T${normalized}+05:30`;
}

export function isFutureISO8601(iso: string): boolean {
  return new Date(iso).getTime() > Date.now();
}

// ─── Pure IST helpers (deterministic over their inputs) ────────────────────────
//
// The helpers above read the wall-clock "now" via `new Date()`. The functions
// below are PURE over their arguments — they derive the IST hour / IST calendar
// date from the passed `Date`/ISO string, so they can be unit- and
// property-tested without mocking the clock. They do NOT change or replace any
// existing exported behavior; they only add reusable, testable primitives.

/** Returns hour 0–23 in Asia/Kolkata (IST) for a SPECIFIC instant. Pure. */
export function istHourOf(instant: Date): number {
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  }).format(instant);
  // en-GB can surface midnight as "24"; normalize to the 0–23 range.
  return Number(hourStr) % 24;
}

/** Returns YYYY-MM-DD in Asia/Kolkata (IST) for a SPECIFIC instant. Pure. */
export function istDateStringOf(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Adds whole calendar days to a YYYY-MM-DD string via UTC arithmetic. Pure. */
export function addDaysToISODate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

/**
 * PURE predicate for the 5:00 PM (17:00 IST) next-day cutoff rule
 * (docs/04-business-logic.md §1, .clinerules "5 PM Cutoff Protocol").
 *
 * Returns `true` iff, at the IST wall-clock instant `now`, edits to the given
 * `deliveryDate` (YYYY-MM-DD) are LOCKED:
 *
 *   - Before 17:00 IST today  → the earliest editable delivery date is tomorrow,
 *     so today and earlier are locked.
 *   - At/after 17:00 IST today → the earliest editable delivery date is the
 *     day-after-tomorrow, so tomorrow and earlier are locked.
 *
 * Concretely: `daysToAdd = istHour >= 17 ? 2 : 1`, the earliest editable date is
 * `istToday + daysToAdd`, and a `deliveryDate` strictly before that is locked.
 * Derives the IST hour and IST date purely from `now`, so the result depends
 * only on the inputs.
 *
 * This does NOT enforce the cutoff anywhere on its own — enforcement already
 * lives across the customer actions (meal-planner / pause / checkout). It only
 * provides a single reusable, testable definition of the rule (Req 11.2).
 */
export function isPastNextDayCutoff(now: Date, deliveryDate: string): boolean {
  const istHour = istHourOf(now);
  const istToday = istDateStringOf(now);
  const daysToAdd = istHour >= RIDER_DAY_ROLLOVER_HOUR_IST ? 2 : 1;
  const earliestEditableDate = addDaysToISODate(istToday, daysToAdd);
  // YYYY-MM-DD strings compare correctly lexicographically.
  return deliveryDate < earliestEditableDate;
}

/**
 * PURE purchase day-attribution helper (Req 11.3 / Property 24).
 *
 * Returns the IST calendar date (YYYY-MM-DD) of the 12:00 AM–11:59 PM IST window
 * that contains the timestamp `purchaseISO`. A purchase at 12:01 AM IST
 * attributes to that day; a purchase at 11:59 PM IST attributes to the same day.
 * Derives the IST date purely from the passed timestamp.
 */
export function purchaseAttributionDate(purchaseISO: string): string {
  return istDateStringOf(new Date(purchaseISO));
}
