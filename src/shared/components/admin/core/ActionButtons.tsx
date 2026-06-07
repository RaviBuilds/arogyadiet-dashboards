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
      className="gap-2 border-slate-200 text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
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
      size="sm"
      onClick={onClick}
      disabled={isLoading}
      className="gap-2 border border-emerald-200 bg-emerald-50 font-medium text-emerald-700 shadow-sm transition-all duration-200 hover:bg-emerald-100"
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
