"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/lib/utils";
import { Bike, PowerOff } from "lucide-react";
import { setRiderOnlineAction } from "@/modules/rider/actions/shiftActions";

type RiderStatusToggleProps = {
  initialStatus: boolean;
};

export function RiderStatusToggle({ initialStatus }: RiderStatusToggleProps) {
  const [isOnDuty, setIsOnDuty] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggle = (checked: boolean) => {
    setIsOnDuty(checked);
    startTransition(async () => {
      const result = await setRiderOnlineAction(checked);
      if (result.error) {
        setIsOnDuty(!checked); // Revert on failure
        console.error(result.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div
      className={cn(
        "p-5 rounded-2xl border-2 transition-colors duration-300 flex items-center justify-between shadow-sm",
        isOnDuty ? "bg-green-50 border-green-200" : "bg-white border-zinc-200",
      )}
    >
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "h-12 w-12 rounded-full flex items-center justify-center transition-colors shrink-0",
            isOnDuty
              ? "bg-green-100 text-green-700"
              : "bg-zinc-100 text-zinc-400",
          )}
        >
          {isOnDuty ? (
            <Bike className="h-6 w-6" />
          ) : (
            <PowerOff className="h-6 w-6" />
          )}
        </div>
        <div>
          <h2 className="font-black text-lg text-zinc-900 leading-tight">
            {isOnDuty ? "You are On Duty" : "You are Offline"}
          </h2>
          <p className="text-sm font-medium text-zinc-500 mt-0.5">
            {isOnDuty ? "Receiving route updates..." : "Toggle to start shift"}
          </p>
        </div>
      </div>
      <Switch
        checked={isOnDuty}
        onCheckedChange={handleToggle}
        disabled={isPending}
        className="scale-125 ml-2"
      />
    </div>
  );
}
