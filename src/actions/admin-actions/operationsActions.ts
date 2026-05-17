"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function fetchRosterData(startDate: string, endDate: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("subscription_daily_preferences")
    .select(
      `
      id,
      preference_date,
      is_paused,
      subscriptions ( subscription_code ),
      customer_profiles ( users ( full_name ) ),
      meal_categories ( name ),
      addresses ( pincode )
    `,
    )
    .gte("preference_date", startDate)
    .lte("preference_date", endDate)
    .order("preference_date", { ascending: true });

  if (error) {
    console.error("Error fetching roster data:", error);
    return [];
  }

  return data || [];
}

export async function revalidateOperationsPage() {
  // This manually busts the ISR cache and forces a fresh database pull
  revalidatePath("/admin/operations");
}
