import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ShoppingBag } from "lucide-react";
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
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">My Shop Orders</h1>
          <p className="text-muted-foreground mt-1">
            Track your purchased products and their delivery status.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-xl shrink-0">
          <Link href="/shop">
            <ShoppingBag className="h-4 w-4 mr-2" />
            Browse Shop
          </Link>
        </Button>
      </div>

      <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3.5 text-sm text-amber-800 flex items-start gap-3">
        <span className="text-base mt-0.5">ℹ️</span>
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
