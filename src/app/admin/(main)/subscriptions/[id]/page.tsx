import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { Subscription360Dashboard } from "@/shared/components/admin/subscriptions/Subscription360Dashboard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/shared/components/ui/button";
import { ChevronLeft } from "lucide-react";

export const revalidate = 0;

export default async function Subscription360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabaseAdmin = createAdminClient();

  // 1. Fetch Core Subscription Data
  const { data: subData, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      *,
      subscription_plans (*),
      customer_profiles (
        id, dietary_preference,
        users ( full_name, email, mobile ),
        addresses (*)
      )
    `)
    .eq("id", id)
    .single();

  if (subError || !subData) notFound();

  // 2. Fetch all daily preferences mapped to this subscription
  const { data: dailyPrefs } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select(`*, meal_categories(code)`)
    .eq("subscription_id", id)
    .order("preference_date", { ascending: true });

  // 3. Fetch all historical and pending subscriptions for this specific customer
  const { data: allCustomerSubs } = await supabaseAdmin
    .from("subscriptions")
    .select(`*, subscription_plans(name, duration_days)`)
    .eq("customer_profile_id", subData.customer_profile_id)
    .order("created_at", { ascending: false });

  const customerUser = Array.isArray(subData.customer_profiles?.users)
    ? subData.customer_profiles.users[0]
    : subData.customer_profiles?.users;

  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto w-full p-4 md:p-8">
      <AdminPageHeader
        title={`${customerUser?.full_name || "Customer"}'s Subscription`}
        description={`Manage plan: ${subData.subscription_code || subData.id.split('-')[0].toUpperCase()}`}
        action={
          <Button variant="outline" asChild>
            <Link href="/customers"><ChevronLeft className="h-4 w-4 mr-2" /> Back to Customers</Link>
          </Button>
        }
      />
      <Subscription360Dashboard 
        subscription={subData} 
        dailyPrefs={dailyPrefs || []} 
        allCustomerSubs={allCustomerSubs || []} 
      />
    </div>
  );
}