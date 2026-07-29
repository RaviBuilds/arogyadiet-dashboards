"use client";

// Top-level switch between the two migration pipelines on the Bulk migration
// page. They are deliberately separate: a MEAL migration is a two-file flow
// (customers, then subscriptions), while a KIT purchase is a single row that
// creates the customer and the kit subscription together.

import Link from "next/link";
import { ArrowLeft, Package, UtensilsCrossed } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { BulkMigrationClient } from "@/shared/components/admin/customers/BulkMigrationClient";
import { KitBulkImportClient } from "@/shared/components/admin/customers/KitBulkImportClient";

type ReferencePlan = {
  code: string;
  name: string;
  duration_days: number;
  pause_credits: number;
  price: number;
};

type ReferenceMeal = { code: string; name: string };

type KitProductReference = { id: string; name: string; base_price: number };

export function BulkImportTabs({
  plans,
  meals,
  kitProducts,
}: {
  plans: ReferencePlan[];
  meals: ReferenceMeal[];
  kitProducts: KitProductReference[];
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/customers">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Customers
        </Link>
      </Button>

      <Tabs defaultValue="meal" className="space-y-6">
        <TabsList>
          <TabsTrigger value="meal" className="gap-2">
            <UtensilsCrossed className="h-4 w-4" />
            Meal customers
          </TabsTrigger>
          <TabsTrigger value="kit" className="gap-2">
            <Package className="h-4 w-4" />
            KIT customers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="meal">
          <BulkMigrationClient plans={plans} meals={meals} />
        </TabsContent>

        <TabsContent value="kit">
          <KitBulkImportClient kitProducts={kitProducts} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
