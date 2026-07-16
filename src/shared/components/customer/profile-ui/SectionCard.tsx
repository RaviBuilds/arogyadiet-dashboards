import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconChip, type IconChipTone } from "./IconChip";

/**
 * SectionCard — the base wrapper for every profile/settings section.
 *
 * Mirrors the dashboard's card language: rounded-3xl, hairline border,
 * shadow-sm, optional tinted gradient wash for "important" sections (e.g.
 * Medical Assessment). Generic enough to be reused by any future customer
 * page (Orders, Subscription, Support) that needs a titled section card.
 */
export function SectionCard({
  icon: Icon,
  iconTone = "green",
  title,
  description,
  action,
  tinted = false,
  children,
  className,
}: {
  icon?: LucideIcon;
  iconTone?: IconChipTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  tinted?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border shadow-sm",
        tinted
          ? "border-emerald-900/10 bg-gradient-to-br from-emerald-50/70 via-white to-white"
          : "border-slate-200 bg-white",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-1 sm:px-6 sm:pt-6">
        <div className="flex items-start gap-3">
          {Icon ? <IconChip icon={Icon} tone={iconTone} /> : null}
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">{children}</div>
    </section>
  );
}
