"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import {
  CustomerClientTable,
  Customer,
} from "@/shared/components/admin/customers/CustomerClientTable";

interface CustomerDashboardProps {
  customers: Customer[];
}

export default function CustomerDashboard({
  customers,
}: CustomerDashboardProps) {
  return (
    <Tabs defaultValue="all" className="w-full space-y-6">
      {/* Modern Pill Navigation */}
      <div className="mb-2">
        <TabsList className="bg-transparent h-auto p-0 flex flex-wrap gap-2 justify-start">
          <TabsTrigger
            value="all"
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            All Customers
          </TabsTrigger>
          <TabsTrigger
            value="active"
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Active Subscriptions
          </TabsTrigger>
          <TabsTrigger
            value="archived"
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Archived
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Submenu Content */}
      <TabsContent value="all" className="m-0 focus-visible:outline-none">
        <CustomerClientTable data={customers} />
      </TabsContent>

      <TabsContent value="active" className="m-0 focus-visible:outline-none">
        <div className="text-center py-12 text-muted-foreground bg-card border rounded-md shadow-sm">
          Active subscriptions view will be built here.
        </div>
      </TabsContent>
      <TabsContent value="archived" className="m-0 focus-visible:outline-none">
        <div className="text-center py-12 text-muted-foreground bg-card border rounded-md shadow-sm">
          Archived customers view will be built here.
        </div>
      </TabsContent>
    </Tabs>
  );
}