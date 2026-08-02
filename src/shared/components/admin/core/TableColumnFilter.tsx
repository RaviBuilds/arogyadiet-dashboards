"use client";

import { Fragment } from "react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Check, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TableColumnFilter — shared in-header column filter for admin /customers tables.
 *
 * Matches the Meal Customers reference: ghost header button with a funnel icon
 * that highlights when a filter is active, dropdown of selectable options.
 *
 * Two modes:
 *  - `single`   — one active value at a time (e.g. Diet, Status).
 *  - `multiple` — any subset of values (e.g. customer Type).
 */

export interface ColumnFilterOption {
  value: string;
  label: string;
}

export interface ColumnFilterSection {
  label?: string;
  options: ColumnFilterOption[];
}

interface BaseProps {
  title: string;
  align?: "start" | "end";
  contentClassName?: string;
}

interface SingleSelectProps extends BaseProps {
  mode: "single";
  value: string;
  onChange: (value: string) => void;
  allValue: string;
  sections: ColumnFilterSection[];
}

interface MultiSelectProps extends BaseProps {
  mode: "multiple";
  values: string[];
  onChange: (values: string[]) => void;
  options: ColumnFilterOption[];
  groupLabel?: string;
}

export type TableColumnFilterProps = SingleSelectProps | MultiSelectProps;

const SELECTED_ITEM = "bg-accent font-semibold";

export function TableColumnFilter(props: TableColumnFilterProps) {
  const align = props.align ?? "start";
  const contentClassName = props.contentClassName ?? "w-[180px]";

  if (props.mode === "single") {
    const { title, value, onChange, allValue, sections } = props;
    const active = value !== allValue;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs font-medium uppercase tracking-wider text-slate-500 transition-all duration-200 hover:text-slate-900 data-[state=open]:bg-slate-100"
          >
            <span className={cn(active && "font-semibold text-slate-900")}>{title}</span>
            <Filter
              className={cn(
                "ml-2 h-3.5 w-3.5",
                active ? "fill-primary/20 text-primary" : "text-muted-foreground/70",
              )}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className={contentClassName}>
          {sections.map((section, sectionIndex) => (
            <Fragment key={section.label ?? sectionIndex}>
              {sectionIndex > 0 && <DropdownMenuSeparator />}
              {section.label && (
                <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
              )}
              {section.options.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => onChange(option.value)}
                  className={cn(
                    "cursor-pointer",
                    value === option.value && SELECTED_ITEM,
                  )}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Multi-select mode
  const { title, values, onChange, options, groupLabel } = props;
  const active = values.length > 0;
  const toggle = (val: string) =>
    onChange(
      values.includes(val)
        ? values.filter((v) => v !== val)
        : [...values, val],
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 text-xs font-medium uppercase tracking-wider text-slate-500 transition-all duration-200 hover:text-slate-900 data-[state=open]:bg-slate-100"
        >
          <span className={cn(active && "font-semibold text-slate-900")}>{title}</span>
          {active && (
            <Badge
              variant="default"
              className="ml-2 h-5 rounded-sm px-1.5 text-[10px]"
            >
              {values.length}
            </Badge>
          )}
          <Filter
            className={cn(
              "ml-2 h-3.5 w-3.5",
              active ? "fill-primary/20 text-primary" : "text-muted-foreground/70",
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {groupLabel && <DropdownMenuLabel>{groupLabel}</DropdownMenuLabel>}
        {options.map((option) => {
          const selected = values.includes(option.value);
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={(e) => e.preventDefault()}
              onClick={() => toggle(option.value)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2",
                selected && SELECTED_ITEM,
              )}
            >
              {option.label}
              {selected && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              onClick={() => onChange([])}
              className="cursor-pointer text-slate-500"
            >
              Clear selection
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
