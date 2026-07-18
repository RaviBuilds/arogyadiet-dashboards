import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import Link from "next/link";

import { Button } from "@/shared/components/ui/button";

import LiveTrackingClient from "./tracking-client";

export const revalidate = 0;

type AddonProductLine = { name: string; quantity: number };

function buildAddonLines(
  addonOrders: unknown,
): AddonProductLine[] {
  if (!Array.isArray(addonOrders) || addonOrders.length === 0) return [];
  const lines: AddonProductLine[] = [];
  for (const addonOrder of addonOrders) {
    const items = (addonOrder as { addon_order_items?: unknown })
      ?.addon_order_items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const name = (item as { products?: { name?: string } })?.products
        ?.name;
      const quantity = (item as { quantity?: number })?.quantity;
      if (typeof name !== "string" || !name) continue;
      if (typeof quantity !== "number") continue;
      lines.push({ name, quantity });
    }
  }
  return lines;
}

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { supabase, user, profile, error: sessionError } =
    await getCustomerSession();
  if (sessionError || !user) redirect("/login");

  // Fetch the specific order, including the rider's details, avatar,
  // destination address, and today's meal (for the breakfast preview).
  const { data: order, error: orderError } = await supabase
    .from("delivery_orders")
    .select(
      `
      id,
      status,
      assigned_rider_id,
      rider:rider_profiles ( users ( full_name, mobile, avatar_url ) ),
      address:addresses ( tag, street_1, landmark, city, lat, lng ),
      meal_category:meal_categories ( name ),
      addon_orders ( addon_order_items ( quantity, products ( name ) ) )
    `,
    )
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return (
      <div className="max-w-4xl mx-auto p-4 text-center mt-20">
        <h2 className="text-2xl font-bold text-zinc-900">Order not found</h2>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/meals">Return to My Meals</Link>
        </Button>
      </div>
    );
  }

  // Safely extract relationships
  const riderProfile = Array.isArray(order.rider)
    ? order.rider[0]
    : order.rider;
  const riderUser = Array.isArray(riderProfile?.users)
    ? riderProfile?.users[0]
    : riderProfile?.users;
  const address = Array.isArray(order.address)
    ? order.address[0]
    : order.address;
  const mealCategory = Array.isArray(order.meal_category)
    ? order.meal_category[0]
    : order.meal_category;

  const addressString = [address?.street_1, address?.landmark, address?.city]
    .filter(Boolean)
    .join(", ");

  // Safely extract Rider variables
  const riderName = riderUser?.full_name || "Assigning Rider...";
  const riderPhone = riderUser?.mobile || null;
  const riderAvatar = riderUser?.avatar_url || null;

  return (
    <LiveTrackingClient
      order={{ id: order.id, status: order.status, assigned_rider_id: order.assigned_rider_id }}
      riderName={riderName}
      riderPhone={riderPhone}
      riderAvatar={riderAvatar}
      addressString={addressString}
      addressTag={address?.tag || null}
      customerName={profile?.full_name || null}
      customerLat={address?.lat ? Number(address.lat) : undefined}
      customerLng={address?.lng ? Number(address.lng) : undefined}
      mealName={mealCategory?.name || null}
      addons={buildAddonLines(order.addon_orders)}
    />
  );
}
