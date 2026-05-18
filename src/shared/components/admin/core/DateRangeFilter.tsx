import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Calendar, RefreshCw, Loader2 } from "lucide-react";

interface DateRangeFilterProps {
  fromDate: string;
  onFromChange: (val: string) => void;
  toDate: string;
  onToChange: (val: string) => void;
  onLoad: () => void;
  isLoading?: boolean;
}

export function DateRangeFilter({
  fromDate,
  onFromChange,
  toDate,
  onToChange,
  onLoad,
  isLoading = false,
}: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 border rounded-md px-3 bg-background">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">FROM</span>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => onFromChange(e.target.value)}
          className="border-0 h-9 w-[130px] p-0 shadow-none focus-visible:ring-0"
        />
        <span className="text-sm font-medium text-muted-foreground">TO</span>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => onToChange(e.target.value)}
          className="border-0 h-9 w-[130px] p-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <Button
        onClick={onLoad}
        disabled={isLoading}
        className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-sm"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Load Range
      </Button>
    </div>
  );
}
