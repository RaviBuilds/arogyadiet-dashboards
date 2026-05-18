
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/shared/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

interface RefreshButtonProps {
  refreshAction: () => Promise<any>;
}

export function RefreshButton({ refreshAction }: RefreshButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleRefresh = async () => {
    startTransition(async () => {
      const { success } = await refreshAction();
      if (success) {
        toast.success("Page refreshed!");
        router.refresh();
      } else {
        toast.error("Failed to refresh page.");
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={isPending}
    >
      {isPending ? (
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      Refresh
    </Button>
  );
}
