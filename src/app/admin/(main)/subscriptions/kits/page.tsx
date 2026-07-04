import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { listKitProductsAction } from "@/actions/admin-actions/kitProductActions";
import { addCalculationsToKitProduct } from "@/types/kitProduct";
import { guardAdminGroup } from "@/lib/auth/adminAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Plus, Package } from "lucide-react";
import { KitsPageClient } from "./KitsPageClient";

export const revalidate = 0;

/**
 * KIT Products List Page
 * 
 * Displays all active KIT products with pricing information and tax calculations.
 * Allows admins to add new KIT products via dialog (Task 4.3).
 * 
 * Requirements: 1.1, 1.2, 1.5
 * Task: 4.1
 */
export default async function KitProductsPage() {
  await guardAdminGroup("subscriptions");

  // Fetch active KIT products
  const result = await listKitProductsAction();

  if (!result.success) {
    return (
      <div className="flex flex-col gap-6">
        <AdminPageHeader
          title="Subscription Management"
          description="Manage subscription plans, KIT products, and view analytics."
        />
        <KitsPageClient products={[]} error={result.error} />
      </div>
    );
  }

  const products = result.data || [];
  const productsWithCalculations = products.map(addCalculationsToKitProduct);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Subscription Management"
        description="Manage subscription plans, KIT products, and view analytics."
      />
      <KitsPageClient products={productsWithCalculations} />
    </div>
  );
}
