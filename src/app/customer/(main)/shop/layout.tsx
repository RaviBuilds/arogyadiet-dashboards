import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The wellness-essentials shop is a MEAL-only offering. KIT and ACCOMMODATION
 * customers get no shop nav link and no cart button, so this layout closes the
 * remaining hole: direct navigation to /shop, /shop/checkout and /shop/orders.
 *
 * Category comes from the middleware-propagated `x-customer-category` header
 * (see src/middleware.ts), so there's no extra DB round trip here. An empty
 * header (no active subscription) is treated as "not restricted", matching how
 * the sidebar decides whether to show the Shop group.
 */
export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const customerCategory = headerStore.get("x-customer-category") || null;

  if (customerCategory === "KIT" || customerCategory === "ACCOMMODATION") {
    redirect("/dashboard?msg=shop-unavailable");
  }

  return children;
}
