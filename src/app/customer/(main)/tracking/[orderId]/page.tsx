import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Bike, Phone, Clock } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";

// IMPORTANT: Adjust this import path if you saved LiveTrackingMap somewhere else!
// import { LiveTrackingMap } from "@/modules/customer/components/LiveTrackingMap";
import { LiveTrackingMap } from "@/modules/customer/component/LiveTrackingMap";

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

  // Fetch the specific order, including the rider's details and the destination address
  const { data: order, error } = await supabase
    .from("delivery_orders")
    .select(
      `
      id,
      status,
      assigned_rider_id,
      rider:rider_profiles ( users ( full_name, mobile ) ),
      address:addresses ( street_1, landmark, city )
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

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          asChild
          variant="outline"
          size="icon"
          className="rounded-full shrink-0"
        >
          <Link href="/meals">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Live Tracking</h1>
          <p className="text-muted-foreground text-sm flex items-center gap-1">
            <Clock className="h-4 w-4" /> Estimated arrival in 15-20 mins
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Order Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Rider Card */}
          <Card className="border-2 shadow-sm">
            <CardContent className="p-6">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4">
                Your Delivery Partner
              </p>
              <div className="flex items-center gap-4 mb-6">
                <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <Bike className="h-7 w-7 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-zinc-900">
                    {riderUser?.full_name || "Assigning Rider..."}
                  </h3>
                  <div className="flex items-center gap-1 text-sm font-medium text-zinc-500 mt-0.5">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    On the way
                  </div>
                </div>
              </div>
              <Button
                asChild
                className="w-full bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl"
              >
                <a href={`tel:${riderUser?.mobile || ""}`}>
                  <Phone className="h-4 w-4 mr-2" /> Call Rider
                </a>
              </Button>
            </CardContent>
          </Card>

          {/* Destination Card */}
          <Card className="border-none shadow-sm bg-zinc-50">
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="bg-white p-3 rounded-full shrink-0 h-fit shadow-sm border border-zinc-100">
                  <MapPin className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Delivering To
                  </p>
                  <p className="font-bold text-zinc-900 mt-1 line-clamp-3 leading-relaxed">
                    {addressString || "Delivery Address"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: THE MAP */}
        <div className="lg:col-span-2 h-[500px] lg:h-auto min-h-[500px] rounded-2xl overflow-hidden shadow-lg border border-zinc-200">
          <LiveTrackingMap
            riderId={order.assigned_rider_id}
            orderStatus={order.status}
          />
        </div>
      </div>
    </div>
  );
}
