// src/lib/kit/resolveCustomerCategory.ts
//
// Which portal a Customer_360 page should render: the customer's current
// Primary_Category.
//
// PURE BY DESIGN — no Supabase, no `server-only`. It takes the already-fetched
// subscription rows so the rule can be unit-tested against every shape that
// matters, which an inline copy inside a server component cannot be.
//
// WHY IT EXISTS: the franchise Customer_360 page passed no `customerCategory` at
// all, so `Customer360Dashboard` fell into its `else` branch and served a
// franchise KIT customer the MEAL tab set (Subscription + Coupons) while KIT,
// Shipping and KIT History never appeared.
//
// DELIBERATELY NOT WIRED INTO THE ADMIN PAGE. `admin/(main)/customers/[id]/page.tsx`
// keeps its own inline copy of this rule. The two are byte-equivalent, and this
// module is transcribed FROM that one, but Core_Business behaviour on the admin
// dashboard must not change as part of franchise work — so the admin page is left
// untouched and this carries the same rule for the franchise page. If the rule
// ever needs to change, change both, and these tests are what say what the rule
// is meant to be.

/** The subscription fields the rule reads. */
export interface CategorizableSubscription {
  status?: string | null;
  customer_category?: string | null;
  starts_on?: string | null;
}

/**
 * The newest subscription, preferring the ACTIVE one.
 *
 * Exported because the page needs the same row the category decision was based
 * on. Ordering is by `starts_on` descending; rows without one sort last, which is
 * why a PENDING kit (no `starts_on` yet) cannot be found this way and is handled
 * by the KIT rule below instead.
 */
export function resolveCurrentSubscription<T extends CategorizableSubscription>(
  subscriptions: readonly T[],
): T | null {
  const active = subscriptions.find((s) => s.status === "ACTIVE");
  if (active) return active;

  return (
    [...subscriptions].sort((a, b) => {
      const aTime = a.starts_on ? new Date(a.starts_on).getTime() : 0;
      const bTime = b.starts_on ? new Date(b.starts_on).getTime() : 0;
      return bTime - aTime;
    })[0] ?? null
  );
}

/**
 * The customer's Primary_Category, or `null` when they hold no subscription at
 * all (a brand-new customer, who gets the MEAL portal by default).
 *
 * THE KIT RULE: holding ANY KIT subscription and NO active subscription of
 * another category means KIT. Stated that way on purpose, rather than reading the
 * category off the newest row:
 *
 *   - a LAPSED kit (expired, replacement not yet sent) keeps the KIT tabs, which
 *     is where the operator goes to send the replacement;
 *   - a brand-new PENDING kit has no `starts_on`, so "newest by start date"
 *     would not find it and the customer would be shown MEAL tabs for a kit that
 *     was just dispatched;
 *   - a customer who has genuinely moved onto an active MEAL plan still gets the
 *     MEAL portal, because that active non-KIT subscription vetoes the rule.
 */
export function resolveCustomerCategory(
  subscriptions: readonly CategorizableSubscription[],
): string | null {
  const hasKitSubscription = subscriptions.some(
    (s) => s.customer_category === "KIT",
  );
  const hasActiveNonKitSubscription = subscriptions.some(
    (s) => s.status === "ACTIVE" && s.customer_category !== "KIT",
  );

  if (hasKitSubscription && !hasActiveNonKitSubscription) return "KIT";

  return resolveCurrentSubscription(subscriptions)?.customer_category ?? null;
}
