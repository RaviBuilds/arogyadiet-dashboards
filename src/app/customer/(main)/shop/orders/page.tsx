import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Info, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { Button } from "@/shared/components/ui/button";
import { ShopOrdersClient } from "./shop-orders-client";

export const revalidate = 0;

export default async function ShopOrdersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", appUser?.id)
    .single();

  if (!profile) redirect("/dashboard");

  const { data: orders } = await supabase
    .from("addon_orders")
    .select(
      `
      id,
      created_at,
      total_amount,
      status,
      target_delivery_date,
      delivery_order_id,
      delivery_orders (delivery_date, status),
      addon_order_items (
        quantity,
        unit_price,
        products (name, category)
      )
    `,
    )
    .eq("customer_profile_id", profile.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            My Shop Orders
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Track your purchased products and their delivery status.
          </p>
        </div>
        <Button
          asChild
          variant="outline"
          className="shrink-0 rounded-xl transition-all duration-200"
        >
          <Link href="/shop">
            <ShoppingBag className="mr-2 h-4 w-4" />
            Browse Shop
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Products with <strong>Purchased</strong> status will be merged into
          your next delivery batch. Once scheduled, the delivery date is locked.
          You can change the delivery date on unscheduled orders using the ⋯
          menu.
        </p>
      </div>

      <ShopOrdersClient orders={orders ?? []} />
    </div>
  );
}
