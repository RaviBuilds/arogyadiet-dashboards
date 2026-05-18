import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Search } from "lucide-react";

export interface SearchOption {
  value: string;
  label: string;
}

interface DataSearchFilterProps {
  searchColumn: string;
  onColumnChange: (val: string) => void;
  searchTerm: string;
  onTermChange: (val: string) => void;
  options: SearchOption[];
}

export function DataSearchFilter({
  searchColumn,
  onColumnChange,
  searchTerm,
  onTermChange,
  options,
}: DataSearchFilterProps) {
  const activeLabel =
    options.find((o) => o.value === searchColumn)?.label || "Search";

  return (
    <div className="flex items-center gap-2 w-full xl:w-auto">
      <Select value={searchColumn} onValueChange={onColumnChange}>
        <SelectTrigger className="w-[180px] bg-background">
          <SelectValue placeholder="Search by..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="relative w-full md:w-[250px]">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={`Search ${activeLabel}...`}
          value={searchTerm}
          onChange={(e) => onTermChange(e.target.value)}
          className="pl-9 bg-background"
        />
      </div>
    </div>
  );
}
