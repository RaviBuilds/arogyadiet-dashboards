import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { Button } from "@/shared/components/ui/button";
import { ChevronLeft, PackageOpen } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { guardAdminGroup } from "@/lib/auth/adminAccess";
import { getShippingInfoAction } from "@/actions/admin-actions/shippingActions";
import { CourierForm } from "./CourierForm";

/**
 * KIT Shipping Dashboard Page
 * 
 * Server Component that fetches customer and subscription data for KIT customers
 * and displays the courier tracking management interface.
 * 
 * Requirements: 5.3, 6.1
 * Task: 13.1
 */

export default async function ShippingDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  
  // Verify admin has access to customers group
  await guardAdminGroup("customers");

  const supabase = createAdminClient();

  // Fetch customer profile with user information
  const { data: customerProfile, error: profileError } = await supabase
    .from("customer_profiles")
    .select(`
      id,
      users!inner (
        id,
        full_name,
        email,
        mobile
      )
    `)
    .eq("id", id)
    .single();

  if (profileError || !customerProfile) {
    console.error("Error fetching customer profile:", profileError);
    notFound();
  }

  // Fetch active KIT subscription for this customer
  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select(`
      id,
      customer_category,
      status,
      starts_on,
      ends_on,
      kit_product_id,
      kit_duration_days,
      kit_products (
        id,
        name,
        base_price,
        tax_rate
      )
    `)
    .eq("customer_profile_id", id)
    .eq("customer_category", "KIT")
    .in("status", ["ACTIVE", "PENDING"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) {
    console.error("Error fetching subscription:", subscriptionError);
    notFound();
  }

  // Verify customer has a KIT subscription (Requirement 5.3)
  if (!subscription) {
    // Redirect back to customer profile if no KIT subscription exists
    redirect(`/admin/customers/${id}`);
  }

  // Fetch existing shipping information if available
  const shippingResult = await getShippingInfoAction(id);
  const existingShippingInfo = (shippingResult.success ? shippingResult.data : null) ?? null;

  // Extract user data
  const userData = customerProfile.users as any;
  const customerName = userData?.full_name || "N/A";
  const customerEmail = userData?.email || "N/A";

  // Extract KIT product data
  const kitProduct = subscription.kit_products as any;
  const kitProductName = kitProduct?.name || "Unknown Product";
  const kitDurationDays = subscription.kit_duration_days || 0;

  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        title="Shipping Management"
        description={`Manage courier tracking for ${customerName}`}
        action={
          <Button variant="outline" asChild>
            <Link href={`/admin/customers/${id}`}>
              <ChevronLeft className="h-4 w-4 mr-2" /> Back to Profile
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6">
        {/* Customer Information Card */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <PackageOpen className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">{customerName}</h3>
              <p className="text-sm text-muted-foreground">{customerEmail}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="font-medium">KIT Product:</span>{" "}
                  <span className="text-muted-foreground">{kitProductName}</span>
                </div>
                <div>
                  <span className="font-medium">Duration:</span>{" "}
                  <span className="text-muted-foreground">{kitDurationDays} days</span>
                </div>
                <div>
                  <span className="font-medium">Status:</span>{" "}
                  <span className="text-muted-foreground capitalize">
                    {subscription.status.toLowerCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Courier Form */}
        <CourierForm
          customerId={id}
          subscriptionId={subscription.id}
          existingShippingInfo={existingShippingInfo}
        />
      </div>
    </div>
  );
}
