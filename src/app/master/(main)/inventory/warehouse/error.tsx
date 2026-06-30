"use client";

export default function WarehouseError() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 p-6 text-center">
      <p className="text-lg font-medium text-destructive">
        Failed to load warehouse data. Please try again.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        There was an error loading the warehouse catalog and metrics. Try
        refreshing the page.
      </p>
    </div>
  );
}
