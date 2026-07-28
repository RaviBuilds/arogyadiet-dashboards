"use client";

// src/shared/components/admin/customers/CustomerHealthLogTab.tsx
// Feature: dietitian-management — Task 12.5.
//
// The "Health Log" tab of `Customer360Dashboard.tsx` (Req 16.2): fetches this
// Customer_Record's Health_Log timeline and Self_Log adherence numbers via the
// admin-scoped `getCustomerHealthLogView` (available to any admin who may at
// least view the "customers" group — NOT restricted to a Dietitian, unlike
// the Dietitian's own `getHealthLogTimeline`), then renders the shared,
// portal-neutral `HealthLogTimeline` and `SelfLogAdherencePanel`.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getCustomerHealthLogView } from "@/actions/admin-actions/customerHealthLogActions";
import { HealthLogTimeline } from "@/shared/components/dietitian/HealthLogTimeline";
import { SelfLogAdherencePanel } from "@/shared/components/dietitian/SelfLogAdherencePanel";
import type { CustomerCategory, HealthLog } from "@/types/dietitian";

interface CustomerHealthLogTabProps {
  customerProfileId: string;
}

export function CustomerHealthLogTab({ customerProfileId }: CustomerHealthLogTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState<CustomerCategory>("MEAL");
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [selfLogs, setSelfLogs] = useState<HealthLog[]>([]);
  const [skippedSelfLogCount, setSkippedSelfLogCount] = useState(0);
  const [datesWithoutSelfLogCount, setDatesWithoutSelfLogCount] = useState(0);
  const [pausedDaysCount, setPausedDaysCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);

    getCustomerHealthLogView(customerProfileId).then((result) => {
      if (cancelled) return;
      setIsLoading(false);
      if (result.success) {
        setCategory(result.data.category);
        setLogs(result.data.logs);
        setSelfLogs(result.data.selfLogs);
        setSkippedSelfLogCount(result.data.skippedSelfLogCount);
        setDatesWithoutSelfLogCount(result.data.datesWithoutSelfLogCount);
        setPausedDaysCount(result.data.pausedDaysCount);
      } else {
        toast.error(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [customerProfileId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading health log history...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <SelfLogAdherencePanel
          category={category}
          selfLogs={selfLogs}
          skippedSelfLogCount={skippedSelfLogCount}
          datesWithoutSelfLogCount={datesWithoutSelfLogCount}
          pausedDaysCount={pausedDaysCount}
        />
      </div>
      <div className="lg:col-span-2">
        <HealthLogTimeline logs={logs} />
      </div>
    </div>
  );
}
