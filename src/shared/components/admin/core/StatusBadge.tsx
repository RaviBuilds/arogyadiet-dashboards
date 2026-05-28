import { Badge } from "@/shared/components/ui/badge";

interface StatusBadgeProps {
  status: string;
  variant?: "dot" | "solid" | "outline";
}

export function StatusBadge({ status, variant = "solid" }: StatusBadgeProps) {
  const normalized = status?.toUpperCase() || "UNKNOWN";

  // Define color mapping logic
  let colorClass = "bg-muted text-muted-foreground hover:bg-muted";

  if (
    ["ACTIVE", "ONLINE", "DELIVERED", "ASSIGNED", "SUCCESS"].includes(
      normalized,
    )
  ) {
    colorClass =
      "bg-emerald-500/10 text-emerald-600 border-emerald-200 hover:bg-emerald-500/20";
  } else if (
    ["PAUSED", "OFFLINE", "CANCELLED", "FAILED"].includes(normalized)
  ) {
    colorClass =
      "bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20";
  } else if (["PENDING", "NOT YET PICKED UP"].includes(normalized)) {
    colorClass =
      "bg-orange-500/10 text-orange-600 border-orange-200 hover:bg-orange-500/20";
  } else if (
    ["OUT_FOR_DELIVERY", "PICKED UP", "IN_TRANSIT", "REACHING_TO_LOCATION"].includes(normalized)
  ) {
    colorClass =
      "bg-blue-500/10 text-blue-600 border-blue-200 hover:bg-blue-500/20";
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
      className={`font-semibold tracking-wide ${colorClass}`}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
