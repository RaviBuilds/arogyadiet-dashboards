import { Badge } from "@/shared/components/ui/badge";

interface StatusBadgeProps {
  status: string;
  variant?: "dot" | "solid" | "outline";
}

export function StatusBadge({ status, variant = "solid" }: StatusBadgeProps) {
  const normalized = status?.toUpperCase() || "UNKNOWN";

  // Define color mapping logic
  let colorClass =
    "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100";

  if (
    ["ACTIVE", "ONLINE", "DELIVERED", "ASSIGNED", "SUCCESS"].includes(
      normalized,
    )
  ) {
    colorClass =
      "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100";
  } else if (
    ["STOPPED", "EXPIRED", "PAUSED", "OFFLINE", "CANCELLED", "FAILED"].includes(
      normalized,
    )
  ) {
    colorClass = "bg-red-50 text-red-700 border-red-200 hover:bg-red-100";
  } else if (
    ["PENDING", "NOT YET PICKED UP", "MEAL_PREPARED"].includes(normalized)
  ) {
    colorClass =
      "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100";
  } else if (["NO PLAN"].includes(normalized)) {
    colorClass = "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100";
  } else if (
    [
      "OUT_FOR_DELIVERY",
      "PICKED UP",
      "PICKED_UP",
      "PICKED",
      "IN_TRANSIT",
      "ON_THE_WAY",
      "REACHING_TO_LOCATION",
    ].includes(normalized)
  ) {
    colorClass = "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100";
  } else if (["ORDER_CREATED"].includes(normalized)) {
    colorClass =
      "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20";
  }

  if (variant === "dot") {
    const dotColor = colorClass.includes("emerald")
      ? "bg-emerald-500"
      : colorClass.includes("destructive")
        ? "bg-destructive"
        : colorClass.includes("orange")
          ? "bg-orange-500"
          : colorClass.includes("blue")
            ? "bg-blue-500"
            : "bg-muted-foreground";

    return (
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
        <span className="text-sm font-medium capitalize">
          {status.toLowerCase()}
        </span>
      </div>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-all duration-200 ${colorClass}`}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
