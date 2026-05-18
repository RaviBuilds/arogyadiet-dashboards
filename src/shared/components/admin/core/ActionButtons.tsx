import { Button } from "@/shared/components/ui/button";
import { Download, RefreshCw, Loader2 } from "lucide-react";

export function ExportButton({
  onClick,
  disabled = false,
  label = "Export",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="gap-2 text-primary hover:text-primary border-primary/20 hover:bg-primary/5"
    >
      <Download className="h-4 w-4" /> {label}
    </Button>
  );
}

export function RefreshButton({
  onClick,
  isLoading = false,
  label = "Refresh Data",
}: {
  onClick: () => void;
  isLoading?: boolean;
  label?: string;
}) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={isLoading}
      className="gap-2 shadow-sm font-medium bg-green-600/10 text-green-700 hover:bg-green-600/20"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      {label}
    </Button>
  );
}
