import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET || "arogya-demo-123";

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    // Determine target month: default is previous month, or override with ?month=5&year=2026
    const now = new Date();
    const targetMonth = searchParams.get("month")
      ? Number(searchParams.get("month"))
      : now.getMonth() === 0
        ? 12
        : now.getMonth();
    const targetYear = searchParams.get("year")
      ? Number(searchParams.get("year"))
      : now.getMonth() === 0
        ? now.getFullYear() - 1
        : now.getFullYear();

    // 27th payment cycle: period runs from 27th of previous month to 26th of target month
    const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1;
    const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear;
    const periodStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-27`;
    const periodEnd = `${targetYear}-${String(targetMonth).padStart(2, "0")}-26`;

    // Get all active riders
    const { data: riders, error: ridersErr } = await supabase
      .from("rider_profiles")
      .select("id")
      .eq("is_active", true);

    if (ridersErr || !riders) {
      return NextResponse.json(
        { error: "Failed to fetch riders" },
        { status: 500 },
      );
    }

    let generated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const rider of riders) {
      // Check if a non-custom summary already exists for this month
      const { data: existing } = await supabase
        .from("rider_monthly_summaries")
        .select("id")
        .eq("rider_id", rider.id)
        .eq("month", targetMonth)
        .eq("year", targetYear)
        .eq("is_custom", false)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      // Get dates covered by existing summaries (custom ones) in this period
      const { data: existingSummaries } = await supabase
        .from("rider_monthly_summaries")
        .select("period_start, period_end")
        .eq("rider_id", rider.id)
        .not("period_start", "is", null)
        .not("period_end", "is", null);

      const coveredDates = new Set<string>();
      for (const s of existingSummaries || []) {
        const start = new Date(s.period_start);
        const end = new Date(s.period_end);
        const rangeStart = new Date(periodStart);
        const rangeEnd = new Date(periodEnd);
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

      // Get delivered orders for this rider in the period
      const { data: orders, error: ordersErr } = await supabase
        .from("delivery_orders")
        .select("id, payout_amount, delivery_date")
        .eq("assigned_rider_id", rider.id)
        .eq("status", "DELIVERED")
        .gte("delivery_date", periodStart)
        .lte("delivery_date", periodEnd);

      if (ordersErr) {
        errors.push(`Rider ${rider.id}: ${ordersErr.message}`);
        continue;
      }

      const eligibleOrders = (orders || []).filter(
        (o) => !coveredDates.has(o.delivery_date),
      );

      if (eligibleOrders.length === 0) {
        skipped++;
        continue;
      }

      const totalEarnings = eligibleOrders.reduce(
        (sum, o) => sum + Number(o.payout_amount || 0),
        0,
      );

      // Get distance from batches
      const { data: batches } = await supabase
        .from("delivery_batches")
        .select("total_distance_km, delivery_date")
        .eq("assigned_rider_id", rider.id)
        .gte("delivery_date", periodStart)
        .lte("delivery_date", periodEnd);

      const eligibleBatches = (batches || []).filter(
        (b) => !coveredDates.has(b.delivery_date),
      );

      const totalDistance = eligibleBatches.reduce(
        (sum, b) => sum + Number(b.total_distance_km || 0),
        0,
      );

      const { error: insertErr } = await supabase
        .from("rider_monthly_summaries")
        .insert({
          rider_id: rider.id,
          month: targetMonth,
          year: targetYear,
          period_start: periodStart,
          period_end: periodEnd,
          total_earnings: Number(totalEarnings.toFixed(2)),
          total_distance_km: Number(totalDistance.toFixed(2)),
          total_deliveries: eligibleOrders.length,
          status: "GENERATED",
          is_custom: false,
        });

      if (insertErr) {
        errors.push(`Rider ${rider.id}: ${insertErr.message}`);
      } else {
        generated++;
      }
    }

    return NextResponse.json({
      success: true,
      month: targetMonth,
      year: targetYear,
      period: `${periodStart} to ${periodEnd}`,
      generated,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error("Generate Rider Payments Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
