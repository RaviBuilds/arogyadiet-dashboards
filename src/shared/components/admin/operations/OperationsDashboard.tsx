"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import TodaysDeliveries from "./TodaysDeliveries";
import PlannedDeliveries from "./PlannedDeliveries";
import DailyMealRoster from "@/shared/components/admin/operations/DailyMealRoster";

interface OperationsDashboardProps {
  deliveries: any[];
  plannedDeliveries: any[];
  initialRosterData: any[];
}

export default function OperationsDashboard({
  deliveries,
  plannedDeliveries,
  initialRosterData,
}: OperationsDashboardProps) {
  return (
    <Tabs defaultValue="today" className="w-full space-y-6">
      {/* Modern Pill Navigation */}
      <div className="mb-2">
        <TabsList className="bg-transparent h-auto p-0 flex flex-wrap gap-2 justify-start">
          <TabsTrigger
            value="today"
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Today's Scheduled
          </TabsTrigger>
          <TabsTrigger
            value="planned"
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Planned (Tomorrow)
          </TabsTrigger>
          <TabsTrigger
            value="roster"
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Daily Meal Roster
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Submenu Content */}
      <TabsContent value="today" className="m-0 focus-visible:outline-none">
        <TodaysDeliveries data={deliveries} />
      </TabsContent>

      <TabsContent value="planned" className="m-0 focus-visible:outline-none">
        <PlannedDeliveries data={plannedDeliveries} />
      </TabsContent>

      <TabsContent value="roster" className="m-0 focus-visible:outline-none">
        <DailyMealRoster initialData={initialRosterData} />
      </TabsContent>
    </Tabs>
  );
}
