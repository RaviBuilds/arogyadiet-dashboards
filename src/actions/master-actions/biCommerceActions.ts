"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  format,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
  parseISO,
} from "date-fns";
import type {
  ShopRevenueMoMPoint,
  InventoryAlert,
  ManufacturingYield,
} from "@/types/bi-dashboard";

/**
 * Commerce - Shop/Add-on Revenue MoM (Date-filtered)
 */
export async function getShopRevenueMoM(
  startDate?: string,
  endDate?: string
): Promise<ShopRevenueMoMPoint[]> {
  const supabase = createAdminClient();
  const now = new Date();
  const rangeStart = startDate ? startOfMonth(parseISO(startDate)) : startOfMonth(subMonths(now, 5));
  const rangeEnd = endDate ? parseISO(endDate) : now;

  const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

  // Fetch addon orders with amounts
  const { data: addonOrders } = await supabase
    .from("addon_orders")
    .select("total_amount, created_at")
    .in("status", ["PAID", "DELIVERED", "COMPLETED"])
    .gte("created_at", `${format(rangeStart, "yyyy-MM-dd")}T00:00:00`)
    .lte("created_at", `${format(rangeEnd, "yyyy-MM-dd")}T23:59:59`);

  return months.map((month) => {
    const monthStart = format(startOfMonth(month), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");

    const monthRevenue = (addonOrders || [])
      .filter((o) => {
        const created = o.created_at?.split("T")[0];
        return created && created >= monthStart && created <= monthEnd;
      })
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    return {
      month: format(month, "MMM yyyy"),
      revenue: monthRevenue,
    };
  });
}

/**
 * Commerce - Inventory Alerts (Expiring or Low Stock)
 */
export async function getInventoryAlerts(
  startDate?: string,
  endDate?: string
): Promise<InventoryAlert[]> {
  const supabase = createAdminClient();
  const today = startDate || format(new Date(), "yyyy-MM-dd");
  const twoWeeksLater = endDate || format(new Date(Date.now() + 14 * 86400000), "yyyy-MM-dd");

  // Lots approaching expiry (within 14 days)
  const { data: expiringLots } = await supabase
    .from("inventory_lots")
    .select("id, product_id, lot_code, expiry_date, quantity, products(name)")
    .gte("expiry_date", today)
    .lte("expiry_date", twoWeeksLater)
    .gt("quantity", 0)
    .order("expiry_date", { ascending: true })
    .limit(20);

  const alerts: InventoryAlert[] = (expiringLots || []).map((lot) => ({
    id: lot.id,
    productName: (lot.products as any)?.name || "Unknown",
    lotCode: lot.lot_code || "",
    alertType: "EXPIRING" as const,
    expiryDate: lot.expiry_date,
    currentStock: Number(lot.quantity || 0),
    minThreshold: null,
  }));

  // Low stock products (below min threshold)
  const { data: lowStockProducts } = await supabase
    .from("products")
    .select("id, name, current_stock, min_stock_threshold")
    .not("min_stock_threshold", "is", null)
    .gt("min_stock_threshold", 0)
    .limit(50);

  const lowStock = (lowStockProducts || [])
    .filter((p) => Number(p.current_stock || 0) < Number(p.min_stock_threshold || 0))
    .map((p) => ({
      id: p.id,
      productName: p.name,
      lotCode: "",
      alertType: "LOW_STOCK" as const,
      expiryDate: null,
      currentStock: Number(p.current_stock || 0),
      minThreshold: Number(p.min_stock_threshold || 0),
    }));

  return [...alerts, ...lowStock].slice(0, 20);
}

/**
 * Commerce - Manufacturing Order Yield
 */
export async function getManufacturingYield(): Promise<ManufacturingYield> {
  const supabase = createAdminClient();

  const { data: manufacturingOrders } = await supabase
    .from("manufacturing_orders")
    .select("raw_material_qty, finished_qty, status")
    .eq("status", "COMPLETED");

  let totalRawConsumed = 0;
  let totalFinishedProduced = 0;

  for (const order of manufacturingOrders || []) {
    totalRawConsumed += Number(order.raw_material_qty || 0);
    totalFinishedProduced += Number(order.finished_qty || 0);
  }

  const yieldPercent =
    totalRawConsumed > 0
      ? Math.round((totalFinishedProduced / totalRawConsumed) * 100)
      : 0;

  return { totalRawConsumed, totalFinishedProduced, yieldPercent };
}
