"use client";

import { useRouter } from "next/navigation";
import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Package } from "lucide-react";
import type { KitProductWithCalculations } from "@/types/kitProduct";
import { KitProductCard } from "./KitProductCard";
import { AddKitProductDialog } from "./AddKitProductDialog";

interface KitsPageClientProps {
  products: KitProductWithCalculations[];
  error?: string;
}

/**
 * Client component for KIT products page with tab navigation
 * 
 * Requirements: 1.1, 1.2, 1.5
 * Task: 4.1
 */
export function KitsPageClient({ products, error }: KitsPageClientProps) {
  const router = useRouter();

  const handleTabChange = (tabId: string) => {
    if (tabId === "Meal Plans") {
      router.push("/subscriptions");
    }
    // Stay on KITs tab if already selected
  };

  return (
    <div className="space-y-4">
      <AdminSubmenuBar
        tabs={["Meal Plans", "KITs"]}
        activeTab="KITs"
        onTabChange={handleTabChange}
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Active Products ({products.length})
              </h2>
              <p className="text-sm text-muted-foreground">
                Ready-to-eat meal packages available for purchase
              </p>
            </div>
            <AddKitProductDialog />
          </div>

          {products.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  No KIT products available
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Add your first KIT product to get started
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((product) => (
                <KitProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
