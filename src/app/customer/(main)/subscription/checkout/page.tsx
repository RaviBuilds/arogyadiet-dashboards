import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CheckoutWizard } from "@/modules/subscription/components/checkout-wizard.tsx";

export default async function CheckoutPage() {
  const supbase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supbase.auth.getUser();
  if (!user || userError) redirect("/login");

  //fetch the plan and profile  in parallel

  const [plansResponse, profileResponse] = await Promise.all([
    supbase
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("duration_days", { ascending: true }),
    supbase
      .from("user")
      .select("dietary_preference, id")
      .eq("auth_user_id", user.id)
      .single(),
  ]);

  return (
    <div className="bg-slate-50/50 min-h-screen">
      <CheckoutWizard
        plans={plansResponse.data || []}
        profile={profileResponse.data}
      />
    </div>
  );
}
