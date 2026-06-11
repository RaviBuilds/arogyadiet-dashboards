"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/services/emailService";
import {
  riderPaymentEmailHtml,
  riderPaymentEmailSubject,
} from "@/emails/RiderPaymentEmail";

// ──────────────────────────────────────────────
// 1. Finance Overview
// ──────────────────────────────────────────────

export async function getFinanceOverview() {
  const supabase = createAdminClient();

  const [paymentsRes, riderSummariesRes, pendingEarningsRes] = await Promise.all([
    supabase.from("payments").select("amount, status, created_at"),
    supabase.from("rider_monthly_summaries").select("total_earnings, status"),
    supabase
      .from("delivery_orders")
      .select("payout_amount, delivery_date")
      .eq("status", "DELIVERED"),
  ]);

  const payments = paymentsRes.data || [];
  const riderSummaries = riderSummariesRes.data || [];

  const now = new Date();
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const totalRevenue = payments
    .filter((p) => ["PAID", "SUCCESS", "CAPTURED"].includes(p.status))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const pendingCollections = payments
    .filter((p) => p.status === "PENDING")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const thisMonthRevenue = payments
    .filter(
      (p) =>
        ["PAID", "SUCCESS", "CAPTURED"].includes(p.status) &&
        p.created_at?.startsWith(thisMonthStr),
    )
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalRiderPayoutsGenerated = riderSummaries.reduce(
    (sum, s) => sum + Number(s.total_earnings || 0),
    0,
  );

  const totalRiderPayoutsPaid = riderSummaries
    .filter((s) => s.status === "PAID")
    .reduce((sum, s) => sum + Number(s.total_earnings || 0), 0);

  const totalRiderPayoutsPending = riderSummaries
    .filter((s) => s.status === "GENERATED")
    .reduce((sum, s) => sum + Number(s.total_earnings || 0), 0);

  const allDelivered = pendingEarningsRes.data || [];
  const totalDeliveryEarnings = allDelivered.reduce(
    (sum, o) => sum + Number(o.payout_amount || 0),
    0,
  );

  return {
    totalRevenue,
    pendingCollections,
    thisMonthRevenue,
    totalRiderPayoutsGenerated,
    totalRiderPayoutsPaid,
    totalRiderPayoutsPending,
    totalDeliveryEarnings,
  };
}

// ──────────────────────────────────────────────
// 2. Subscription Payments List
// ──────────────────────────────────────────────

export async function getSubscriptionPayments(filters?: {
  fromDate?: string;
  toDate?: string;
  status?: string;
  method?: string;
}) {
  const supabase = createAdminClient();

  let query = supabase
    .from("payments")
    .select(
      `id, amount, status, payment_method, paid_at, created_at,
       customer_profiles ( users ( full_name, email ) ),
       subscriptions ( subscription_code, plan_id, subscription_plans ( name ) )`,
    )
    .order("created_at", { ascending: false });

  if (filters?.fromDate) {
    query = query.gte("created_at", `${filters.fromDate}T00:00:00`);
  }
  if (filters?.toDate) {
    query = query.lte("created_at", `${filters.toDate}T23:59:59`);
  }
  if (filters?.status && filters.status !== "ALL") {
    query = query.eq("status", filters.status);
  }
  if (filters?.method && filters.method !== "ALL") {
    query = query.eq("payment_method", filters.method);
  }

  const { data, error } = await query.limit(200);

  if (error) {
    console.error("Error fetching subscription payments:", error);
    return [];
  }

  return (data || []).map((p: any) => ({
    id: p.id,
    amount: Number(p.amount || 0),
    status: p.status,
    paymentMethod: p.payment_method,
    paidAt: p.paid_at,
    createdAt: p.created_at,
    customerName: p.customer_profiles?.users?.full_name || "N/A",
    customerEmail: p.customer_profiles?.users?.email || "",
    subscriptionCode: p.subscriptions?.subscription_code || "N/A",
    planName: p.subscriptions?.subscription_plans?.name || "N/A",
  }));
}

// ──────────────────────────────────────────────
// 3. Rider Payouts - Get All Riders with Earnings
// ──────────────────────────────────────────────

export async function getAllRidersWithEarnings() {
  const supabase = createAdminClient();

  const { data: riders, error } = await supabase
    .from("rider_profiles")
    .select(
      `id, employee_code,
       users!inner ( id, full_name, email, mobile ),
       rider_monthly_summaries ( id, month, year, period_start, period_end, total_earnings, total_distance_km, total_deliveries, status, is_custom, paid_at, paid_notes, created_at )`,
    )
    .eq("is_active", true);

  if (error) {
    console.error("Error fetching riders with earnings:", error);
    return [];
  }

  const results = [];

  for (const rider of riders || []) {
    const summaries = (rider.rider_monthly_summaries || []) as any[];
    summaries.sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const totalPaid = summaries
      .filter((s: any) => s.status === "PAID")
      .reduce((sum: number, s: any) => sum + Number(s.total_earnings || 0), 0);

    const totalPending = summaries
      .filter((s: any) => s.status === "GENERATED")
      .reduce((sum: number, s: any) => sum + Number(s.total_earnings || 0), 0);

    // Calculate unpaid delivered earnings not yet covered by any summary
    const { data: deliveredOrders } = await supabase
      .from("delivery_orders")
      .select("payout_amount, delivery_date")
      .eq("assigned_rider_id", rider.id)
      .eq("status", "DELIVERED");

    const totalDeliveredEarnings = (deliveredOrders || []).reduce(
      (sum: number, o: any) => sum + Number(o.payout_amount || 0),
      0,
    );

    const uncoveredEarnings = totalDeliveredEarnings - totalPaid - totalPending;

    results.push({
      id: rider.id,
      employeeCode: rider.employee_code || "N/A",
      fullName: (rider.users as any)?.full_name || "N/A",
      email: (rider.users as any)?.email || "",
      mobile: (rider.users as any)?.mobile || "",
      summaries,
      totalPaid,
      totalPending,
      uncoveredEarnings: Math.max(0, uncoveredEarnings),
      totalDeliveredEarnings,
    });
  }

  return results;
}

// ──────────────────────────────────────────────
// 4. Generate Monthly Payment for a Rider
// ──────────────────────────────────────────────

export async function generateMonthlyPayment(
  riderId: string,
  month: number,
  year: number,
) {
  const supabase = createAdminClient();

  // Check if summary already exists for this month
  const { data: existing } = await supabase
    .from("rider_monthly_summaries")
    .select("id")
    .eq("rider_id", riderId)
    .eq("month", month)
    .eq("year", year)
    .eq("is_custom", false)
    .limit(1);

  if (existing && existing.length > 0) {
    return { error: "Payment summary already exists for this month." };
  }

  // 27th payment cycle: period runs from 27th of previous month to 26th of current month
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const periodStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-27`;
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-26`;

  // Get dates already covered by existing custom summaries
  const coveredDates = await getCoveredDates(supabase, riderId, periodStart, periodEnd);

  // Query delivered orders in the period, excluding already-covered dates
  let query = supabase
    .from("delivery_orders")
    .select("id, payout_amount, delivery_date")
    .eq("assigned_rider_id", riderId)
    .eq("status", "DELIVERED")
    .gte("delivery_date", periodStart)
    .lte("delivery_date", periodEnd);

  const { data: orders, error: ordersErr } = await query;

  if (ordersErr) {
    return { error: ordersErr.message };
  }

  // Filter out already-covered dates
  const eligibleOrders = (orders || []).filter(
    (o) => !coveredDates.has(o.delivery_date),
  );

  const totalEarnings = eligibleOrders.reduce(
    (sum, o) => sum + Number(o.payout_amount || 0),
    0,
  );

  // Calculate total distance from batches in this period
  const { data: batches } = await supabase
    .from("delivery_batches")
    .select("total_distance_km")
    .eq("assigned_rider_id", riderId)
    .gte("delivery_date", periodStart)
    .lte("delivery_date", periodEnd);

  const totalDistance = (batches || []).reduce(
    (sum, b) => sum + Number(b.total_distance_km || 0),
    0,
  );

  const { data: summary, error: insertErr } = await supabase
    .from("rider_monthly_summaries")
    .insert({
      rider_id: riderId,
      month,
      year,
      period_start: periodStart,
      period_end: periodEnd,
      total_earnings: Number(totalEarnings.toFixed(2)),
      total_distance_km: Number(totalDistance.toFixed(2)),
      total_deliveries: eligibleOrders.length,
      status: "GENERATED",
      is_custom: false,
    })
    .select("id")
    .single();

  if (insertErr) {
    return { error: insertErr.message };
  }

  await logAdminAction("CREATE", "rider_payment", summary?.id ?? null, {
    rider_id: riderId,
    month,
    year,
  });
  revalidatePath("/master/finance");
  return { success: true, summaryId: summary?.id };
}

// ──────────────────────────────────────────────
// 5. Create Custom Payment (date range)
// ──────────────────────────────────────────────

export async function createCustomPayment(
  riderId: string,
  fromDate: string,
  toDate: string,
) {
  const supabase = createAdminClient();

  // Get dates already covered by existing summaries
  const coveredDates = await getCoveredDates(supabase, riderId, fromDate, toDate);

  // Query delivered orders in the period, excluding already-covered dates
  const { data: orders, error: ordersErr } = await supabase
    .from("delivery_orders")
    .select("id, payout_amount, delivery_date")
    .eq("assigned_rider_id", riderId)
    .eq("status", "DELIVERED")
    .gte("delivery_date", fromDate)
    .lte("delivery_date", toDate);

  if (ordersErr) {
    return { error: ordersErr.message };
  }

  const eligibleOrders = (orders || []).filter(
    (o) => !coveredDates.has(o.delivery_date),
  );

  if (eligibleOrders.length === 0) {
    return { error: "No unpaid deliveries found in this date range." };
  }

  const totalEarnings = eligibleOrders.reduce(
    (sum, o) => sum + Number(o.payout_amount || 0),
    0,
  );

  const { data: batches } = await supabase
    .from("delivery_batches")
    .select("total_distance_km, delivery_date")
    .eq("assigned_rider_id", riderId)
    .gte("delivery_date", fromDate)
    .lte("delivery_date", toDate);

  const eligibleBatches = (batches || []).filter(
    (b) => !coveredDates.has(b.delivery_date),
  );

  const totalDistance = eligibleBatches.reduce(
    (sum, b) => sum + Number(b.total_distance_km || 0),
    0,
  );

  const startDate = new Date(fromDate);
  const month = startDate.getMonth() + 1;
  const year = startDate.getFullYear();

  const { data: summary, error: insertErr } = await supabase
    .from("rider_monthly_summaries")
    .insert({
      rider_id: riderId,
      month,
      year,
      period_start: fromDate,
      period_end: toDate,
      total_earnings: Number(totalEarnings.toFixed(2)),
      total_distance_km: Number(totalDistance.toFixed(2)),
      total_deliveries: eligibleOrders.length,
      status: "GENERATED",
      is_custom: true,
    })
    .select("id")
    .single();

  if (insertErr) {
    return { error: insertErr.message };
  }

  await logAdminAction("CREATE", "rider_payment", summary?.id ?? null, {
    rider_id: riderId,
    from_date: fromDate,
    to_date: toDate,
    is_custom: true,
  });
  revalidatePath("/master/finance");
  return { success: true, summaryId: summary?.id, totalEarnings, totalDeliveries: eligibleOrders.length };
}

// ──────────────────────────────────────────────
// 6. Mark Payment as Paid
// ──────────────────────────────────────────────

export async function markPaymentAsPaid(summaryId: string, notes: string) {
  const supabase = createAdminClient();
  const userSupabase = await createClient();

  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  // Get the summary details first
  const { data: summary, error: fetchErr } = await supabase
    .from("rider_monthly_summaries")
    .select(
      `id, rider_id, total_earnings, period_start, period_end, month, year,
       rider_profiles ( users ( full_name, email ) )`,
    )
    .eq("id", summaryId)
    .single();

  if (fetchErr || !summary) {
    return { error: "Payment summary not found." };
  }

  // Get admin user id
  let adminUserId: string | null = null;
  if (user) {
    const { data: adminUser } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();
    adminUserId = adminUser?.id || null;
  }

  const { error: updateErr } = await supabase
    .from("rider_monthly_summaries")
    .update({
      status: "PAID",
      paid_at: new Date().toISOString(),
      paid_notes: notes,
      paid_by: adminUserId,
    })
    .eq("id", summaryId);

  if (updateErr) {
    return { error: updateErr.message };
  }

  // Send email notification to rider
  const riderUser = (summary.rider_profiles as any)?.users;
  if (riderUser?.email) {
    const periodLabel =
      summary.period_start && summary.period_end
        ? `${summary.period_start} to ${summary.period_end}`
        : `${getMonthName(summary.month)}  ${summary.year}`;

    try {
      await sendEmail(
        riderUser.email,
        riderPaymentEmailSubject(),
        riderPaymentEmailHtml({
          name: riderUser.full_name || "Rider",
          amount: Number(summary.total_earnings || 0),
          period: periodLabel,
          notes: notes || "",
          paidDate: new Date().toLocaleDateString("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
        }),
      );
    } catch (emailErr) {
      console.error("Failed to send rider payment email:", emailErr);
    }
  }

  await logAdminAction("UPDATE", "rider_payment", summaryId, { status: "PAID" });

  revalidatePath("/master/finance");
  revalidatePath("/rider/payout");
  return { success: true };
}

// ──────────────────────────────────────────────
// 7. System Settings
// ──────────────────────────────────────────────

export async function getSystemSettings() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select("*")
    .eq("id", "global")
    .single();

  if (error) {
    return { rider_payout_per_km: 16, default_dispatch_time: "00:10:00" };
  }
  return data;
}

export async function updateSystemSettings(settings: {
  rider_payout_per_km?: number;
  default_dispatch_time?: string;
}) {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("system_settings")
    .update({
      ...settings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "global");

  if (error) {
    return { error: error.message };
  }

  await logAdminAction("UPDATE", "system_settings", "global", settings);

  revalidatePath("/master/finance");
  revalidatePath("/admin/operations");
  return { success: true };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function getCoveredDates(
  supabase: ReturnType<typeof createAdminClient>,
  riderId: string,
  fromDate: string,
  toDate: string,
): Promise<Set<string>> {
  const { data: existingSummaries } = await supabase
    .from("rider_monthly_summaries")
    .select("period_start, period_end")
    .eq("rider_id", riderId)
    .not("period_start", "is", null)
    .not("period_end", "is", null);

  const coveredDates = new Set<string>();

  for (const summary of existingSummaries || []) {
    const start = new Date(summary.period_start);
    const end = new Date(summary.period_end);
    const rangeStart = new Date(fromDate);
    const rangeEnd = new Date(toDate);

    // Only process if there's overlap
    if (start <= rangeEnd && end >= rangeStart) {
      const iterStart = start > rangeStart ? start : rangeStart;
      const iterEnd = end < rangeEnd ? end : rangeEnd;
      const current = new Date(iterStart);
      while (current <= iterEnd) {
        coveredDates.add(current.toISOString().split("T")[0]);
        current.setDate(current.getDate() + 1);
      }
    }
  }

  return coveredDates;
}

function getMonthName(month: number): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return months[month - 1] || "";
}
