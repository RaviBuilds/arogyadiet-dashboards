import { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AdminPageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function AdminPageHeader({
  title,
  description,
  action,
  className,
}: AdminPageHeaderProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-slate-200/50 p-6 shadow-sm shadow-primary/5",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-linear-to-br from-rose-50/95 via-orange-50/90 to-lime-50/85"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-primary/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-8 left-1/4 size-32 rounded-full bg-secondary/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/50 to-transparent"
        aria-hidden
      />

      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
            {title}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
            {description}
          </p>
        </div>
        {action ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-3 transition-all duration-200",
              "[&_button]:border-white/70 [&_button]:shadow-sm",
              "[&_button]:backdrop-blur-sm",
              "[&_button[data-variant=outline]]:bg-white/85",
              "[&_button[data-variant=outline]]:hover:bg-white",
              "[&_button[data-variant=outline]]:hover:shadow-md",
              "[&_button[data-variant=ghost]]:bg-white/60",
              "[&_button[data-variant=ghost]]:hover:bg-white/85",
            )}
          >
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
