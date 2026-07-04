import { redirect } from "next/navigation";

/**
 * Legacy KIT Shipping Dashboard route.
 *
 * Shipping management now lives inside the Customer 360 Dashboard as a
 * dedicated "Shipping" tab (visible only for KIT customers), alongside the
 * "KIT" info tab. This route redirects old links/bookmarks there.
 */
export default async function ShippingDashboardRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/customers/${id}?tab=Shipping`);
}
