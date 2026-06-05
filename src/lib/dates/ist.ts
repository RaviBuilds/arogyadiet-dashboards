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
