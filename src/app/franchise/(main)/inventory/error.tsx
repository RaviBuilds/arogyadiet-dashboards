"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

export default function FranchiseInventoryError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 p-8 text-center">
      <AlertCircle className="size-10 text-destructive mb-4" />
      <p className="text-lg font-medium text-destructive">
        Failed to load inventory
      </p>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">
        There was an error loading your franchise inventory. Please try again.
      </p>
      <Button
        onClick={reset}
        variant="outline"
        className="mt-6"
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}
