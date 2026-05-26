import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { Button } from "@/shared/components/ui/button";

import LiveTrackingClient from "./tracking-client";

export const revalidate = 0;

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch the specific order, including the rider's details, avatar, and destination address
  const { data: order, error } = await supabase
    .from("delivery_orders")
    .select(
      `
      id,
      status,
      assigned_rider_id,
      rider:rider_profiles ( users ( full_name, mobile, avatar_url ) ),
      address:addresses ( street_1, landmark, city, lat, lng )
    `,
    )
    .eq("id", orderId)
    .single();

  if (error || !order) {
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

  const addressString = [address?.street_1, address?.landmark, address?.city]
    .filter(Boolean)
    .join(", ");

  // Safely extract Rider variables
  const riderName = riderUser?.full_name || "Assigning Rider...";
  const riderPhone = riderUser?.mobile || null;
  const riderAvatar = riderUser?.avatar_url || null;

  // Dynamic status formatting
  const formatStatus = (status: string) => {
    if (status === "OUT_FOR_DELIVERY") return "Out for delivery";
    if (status === "REACHING_TO_LOCATION") return "Rider is arriving";
    if (status === "ASSIGNED") return "Rider assigned";
    if (status === "DELIVERED") return "Delivered";
    return "Preparing...";
  };


  return (
    <LiveTrackingClient
      order={order}
      riderName={riderName}
      riderPhone={riderPhone}
      riderAvatar={riderAvatar}
      addressString={addressString}
      customerLat={address?.lat ? Number(address.lat) : undefined}
      customerLng={address?.lng ? Number(address.lng) : undefined}
    />
  );
}
