import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { Info, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { ShopOrdersClient } from "./shop-orders-client";

export const revalidate = 0;

export default async function ShopOrdersPage() {
  const { supabase, user, customerProfileId, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");
  if (!customerProfileId) redirect("/dashboard");

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
    .eq("customer_profile_id", customerProfileId)
    .order("created_at", { ascending: false });

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      {/* Page header — same anchor pattern used across every customer page
          (Stay History, Kit History, Health Report): a tone-tinted IconChip
          beside the title, never a bare heading. */}
      <div className="reveal-rise flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <IconChip icon={ShoppingBag} tone="coral" size="lg" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              My Shop Orders
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Track your purchased products and their delivery status.
            </p>
          </div>
        </div>
        <Link
          href="/shop"
          className="group inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-emerald-900/10 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition-all duration-200 hover:border-emerald-300/60 hover:shadow-md active:scale-[0.98]"
        >
          <ShoppingBag className="h-4 w-4" />
          Browse Shop
        </Link>
      </div>

      <div
        className="reveal-rise flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800"
        style={{ ["--reveal-delay" as string]: "150ms" }}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Products with <strong>Purchased</strong> status will be merged into
          your next delivery batch. Once scheduled, the delivery date is locked.
          You can change the delivery date on unscheduled orders using the ⋯
          menu.
        </p>
      </div>

      <div
        className="reveal-rise"
        style={{ ["--reveal-delay" as string]: "300ms" }}
      >
        <ShopOrdersClient orders={orders ?? []} />
      </div>
    </div>
  );
}
