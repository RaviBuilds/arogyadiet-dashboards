"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Save, Loader2, IndianRupee, Clock } from "lucide-react";
import { updateSystemSettings } from "@/actions/admin-actions/financeActions";
import { toast } from "sonner";

interface SystemSettings {
  rider_payout_per_km: number;
  default_dispatch_time: string;
  updated_at?: string;
}

export function SettingsTab({
  initialSettings,
}: {
  initialSettings: SystemSettings;
}) {
  const [payoutPerKm, setPayoutPerKm] = useState(
    String(initialSettings.rider_payout_per_km || 16),
  );
  const [dispatchTime, setDispatchTime] = useState(
    initialSettings.default_dispatch_time || "00:10",
  );
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateSystemSettings({
        rider_payout_per_km: Number(payoutPerKm),
        default_dispatch_time: dispatchTime,
      });
      if (result.success) {
        toast.success("Settings updated successfully.");
      } else {
        toast.error(result.error || "Failed to update settings.");
      }
    });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardContent className="p-6 space-y-6">
          <div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              Rider Payout Configuration
            </h3>
            <p className="text-sm text-muted-foreground">
              These settings apply globally to all rider payout calculations.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="payout-per-km"
                className="flex items-center gap-2"
              >
                <IndianRupee className="h-4 w-4 text-muted-foreground" />
                Payout Per Kilometer (₹)
              </Label>
              <Input
                id="payout-per-km"
                type="number"
                step="0.5"
                min="0"
                value={payoutPerKm}
                onChange={(e) => setPayoutPerKm(e.target.value)}
                className="max-w-[200px]"
                placeholder="16.00"
              />
              <p className="text-xs text-muted-foreground">
                Amount paid to riders per kilometer of delivery distance.
                Currently ₹{payoutPerKm}/km.
              </p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="dispatch-time"
                className="flex items-center gap-2"
              >
                <Clock className="h-4 w-4 text-muted-foreground" />
                Default Dispatch Time
              </Label>
              <Input
                id="dispatch-time"
                type="time"
                value={dispatchTime}
                onChange={(e) => setDispatchTime(e.target.value)}
                className="max-w-[200px]"
              />
              <p className="text-xs text-muted-foreground">
                Time at which automated dispatch runs daily.
              </p>
            </div>
          </div>

          {initialSettings.updated_at && (
            <p className="text-xs text-muted-foreground border-t pt-4">
              Last updated:{" "}
              {new Date(initialSettings.updated_at).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={isPending}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
