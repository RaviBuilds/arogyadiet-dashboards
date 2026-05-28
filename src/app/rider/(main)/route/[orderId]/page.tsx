import Link from "next/link";
import { redirect } from "next/navigation";
import { getRiderOperationalDeliveryDate } from "@/lib/dates/ist";
import {
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Navigation,
  Phone,
  Utensils,
} from "lucide-react";
import { LiveLocationTracker } from "@/modules/rider/components/LiveLocationTracker";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  markOrderDeliveredAction,
  updateDeliveryStatusAction,
} from "@/actions/rider-actions/routeActions";

export const revalidate = 0;

type Related<T> = T | T[] | null;

type DeliveryAddress = {
  street_1: string | null;
  street_2: string | null;
  landmark: string | null;
  city: string | null;
  pincode: string | null;
  lat?: number | null;
  lng?: number | null;
};

type MealCategory = {
  name: string | null;
};

type CustomerProfile = {
  users:
    | {
        full_name: string | null;
        mobile: string | null;
      }
    | {
        full_name: string | null;
        mobile: string | null;
      }[]
    | null;
};

function firstRelated<T>(value: Related<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function buildAddressLine(address: DeliveryAddress | null) {
  return [
    address?.street_1,
    address?.street_2,
    address?.landmark,
    address?.city,
    address?.pincode,
  ]
    .filter(Boolean)
    .join(", ");
}

export default async function RiderDeliveryDetailPage({
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

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (appUserError || !appUser) {
    return (
      <DeliverySetupError
        title="Rider account not readable"
        message={appUserError?.message || "Check users table RLS."}
      />
    );
  }

  const { data: riderProfile, error: riderProfileError } = await supabase
    .from("rider_profiles")
    .select("id, is_online")
    .eq("user_id", appUser.id)
    .single();

  if (riderProfileError || !riderProfile) {
    return (
      <DeliverySetupError
        title="Rider profile not readable"
        message={
          riderProfileError?.message || "Check rider_profiles table RLS."
        }
      />
    );
  }
  if (!riderProfile.is_online) redirect("/dashboard");

  const operationalDate = getRiderOperationalDeliveryDate();
  const { data: order, error } = await supabase
    .from("delivery_orders")
    .select(
      `
      id,
      status,
      payout_amount,
      delivery_date,
      meal_category:meal_categories ( name ),
      delivery_address:addresses ( street_1, street_2, landmark, city, pincode, lat, lng ),
      customer_profile:customer_profiles ( users ( full_name, mobile ) )
    `,
    )
    .eq("id", orderId)
    .eq("assigned_rider_id", riderProfile.id)
    .eq("delivery_date", operationalDate)
    .single();

  if (error || !order) {
    return (
      <div className="p-4 space-y-4">
        <Button asChild variant="outline" className="rounded-xl">
          <Link href="/route">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to route
          </Link>
        </Button>
        <Card className="border-dashed border-2 border-zinc-200 shadow-none bg-white rounded-2xl">
          <CardContent className="p-6 text-center">
            <h1 className="text-xl font-black text-zinc-900">
              Delivery not found
            </h1>
            <p className="mt-2 text-sm font-medium text-zinc-500">
              This delivery is not assigned to your active route.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const mealCategory = firstRelated(
    order.meal_category as Related<MealCategory>,
  );
  const address = firstRelated(
    order.delivery_address as Related<DeliveryAddress>,
  );
  const profile = firstRelated(
    order.customer_profile as Related<CustomerProfile>,
  );
  const customerUser = firstRelated(profile?.users ?? null);
  const addressLine = buildAddressLine(address);

  const destLat = address?.lat;
  const destLng = address?.lng;
  const mapsUrl =
    destLat != null && destLng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          addressLine,
        )}`;

  const canMarkOnTheWay = order.status === "OUT_FOR_DELIVERY";
  const canMarkDelivered = order.status === "REACHING_TO_LOCATION";

  async function markOnTheWay() {
    "use server";
    await updateDeliveryStatusAction(
      orderId,
      "REACHING_TO_LOCATION",
      "Rider is reaching to location",
    );
    redirect(`/route/${orderId}`);
  }

  async function markDelivered() {
    "use server";
    await markOrderDeliveredAction(orderId);
    redirect("/route");
  }

  return (
    <div className="p-4 space-y-5 animate-in fade-in slide-in-from-bottom-4">
      <Button asChild variant="outline" className="rounded-xl">
        <Link href="/route">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to route
        </Link>
      </Button>

      <Card className="border-none shadow-sm bg-white rounded-2xl">
        <CardContent className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Customer
              </p>
              <h1 className="mt-1 text-2xl font-black text-zinc-900">
                {customerUser?.full_name || "Customer"}
              </h1>
            </div>
            <div className="flex flex-col items-end gap-2 mt-1">
              <LiveLocationTracker
                riderId={riderProfile.id}
                isDelivering={
                  order.status === "OUT_FOR_DELIVERY" ||
                  order.status === "REACHING_TO_LOCATION"
                }
              />
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-700">
                {String(order.status).replaceAll("_", " ")}
              </span>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex gap-3 rounded-xl bg-orange-50 p-3 text-orange-800">
              <Utensils className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wider">
                  Meal
                </p>
                <p className="font-bold">{mealCategory?.name || "Meal"}</p>
              </div>
            </div>

            <div className="flex gap-3 rounded-xl bg-blue-50 p-3 text-blue-900">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wider">
                  Address
                </p>
                <p className="font-semibold">
                  {addressLine || "Address pending"}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button asChild variant="outline" className="h-12 rounded-xl">
              <a
                href={`tel:${customerUser?.mobile || ""}`}
                aria-disabled={!customerUser?.mobile}
              >
                <Phone className="mr-2 h-4 w-4" />
                Call
              </a>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-xl">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!addressLine}
              >
                <Navigation className="mr-2 h-4 w-4" />
                Maps
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {canMarkOnTheWay && (
        <form action={markOnTheWay}>
          <Button className="h-14 w-full rounded-2xl bg-zinc-900 text-base font-bold text-white hover:bg-zinc-800">
            <Navigation className="mr-2 h-5 w-5" />
            Notify to prepare for delivery
          </Button>
        </form>
      )}

      {canMarkDelivered && (
        <form action={markDelivered}>
          <Button className="h-14 w-full rounded-2xl bg-green-600 text-base font-bold text-white hover:bg-green-700">
            <CheckCircle2 className="mr-2 h-5 w-5" />
            Mark Delivered
          </Button>
        </form>
      )}
    </div>
  );
}

function DeliverySetupError({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="p-4 space-y-4">
      <Button asChild variant="outline" className="rounded-xl">
        <Link href="/route">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to route
        </Link>
      </Button>
      <Card className="border-dashed border-2 border-red-200 shadow-none bg-white rounded-2xl">
        <CardContent className="p-6 text-center">
          <h1 className="text-xl font-black text-red-700">{title}</h1>
          <p className="mt-2 text-sm font-medium text-zinc-600">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
