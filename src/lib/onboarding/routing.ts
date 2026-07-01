// src/lib/onboarding/routing.ts
// Pure delivery-routing eligibility for onboarded subscriptions.
//
// An onboarded customer's subscription becomes eligible for delivery routing
// on and after its selected start date, and is excluded before it. This is the
// single, testable definition of that rule; enforcement lives in the routing /
// dispatch queries that consume it.
//
// Requirements validated: 6.7, 6.8

/**
 * Pure predicate: is a subscription with start date `startDate` eligible for
 * delivery routing on `currentDate`?
 *
 * Returns `true` if and only if `currentDate >= startDate` (Property 7):
 *   - On or after the start date → routable (Req 6.7)
 *   - Strictly before the start date → excluded (Req 6.8)
 *
 * Both arguments are calendar dates in `YYYY-MM-DD` (IST operational day)
 * format, which compare correctly lexicographically. The comparison is done on
 * the normalized date portion so any accidental time component is ignored.
 */
export function isRoutable(startDate: string, currentDate: string): boolean {
  return toDatePart(currentDate) >= toDatePart(startDate);
}

/** Returns the `YYYY-MM-DD` date portion of a date string. */
function toDatePart(value: string): string {
  // Handles both "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm..." forms.
  return value.slice(0, 10);
}
