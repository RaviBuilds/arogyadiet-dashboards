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
    <div className="flex w-full items-center gap-4 xl:w-auto">
      <Select value={searchColumn} onValueChange={onColumnChange}>
        <SelectTrigger className="w-[180px] border-slate-200 bg-white transition-all duration-200">
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
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          placeholder={`Search ${activeLabel}...`}
          value={searchTerm}
          onChange={(e) => onTermChange(e.target.value)}
          className="border-slate-200 bg-white pl-9 transition-all duration-200 focus-visible:ring-emerald-500/20"
        />
      </div>
    </div>
  );
}
