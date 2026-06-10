"use client";

import { useState } from "react";
import { Apple, LifeBuoy, MessageCircle, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/lib/utils";

const TEMP_SUPPORT_WHATSAPP = "918639659020";

const SUPPORT_OPTIONS = [
  {
    title: "Customer Support",
    subtext: "Order & account help",
    icon: LifeBuoy,
    iconClassName: "text-blue-600",
    iconBgClassName: "bg-blue-50",
    href: `https://wa.me/${TEMP_SUPPORT_WHATSAPP}?text=Hi%20Support,%20I%20need%20help%20with%20my%20account.`,
  },
  {
    title: "Talk to a Dietitian",
    subtext: "Meal plans & nutrition",
    icon: Apple,
    iconClassName: "text-emerald-600",
    iconBgClassName: "bg-emerald-50",
    href: `https://wa.me/${TEMP_SUPPORT_WHATSAPP}?text=Hi,%20I%20would%20like%20to%20consult%20a%20dietitian.`,
  },
] as const;

export function FloatingSupportMenu() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="fixed right-6 z-50 flex flex-col items-end bottom-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] print:hidden">
        <PopoverContent
          side="top"
          align="end"
          sideOffset={16}
          className="w-64 gap-0 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-xl ring-0 backdrop-blur-md"
        >
          <div className="px-2 py-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Help & Support
            </p>
          </div>
          {SUPPORT_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <a
                key={option.title}
                href={option.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-slate-100"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    option.iconBgClassName,
                  )}
                >
                  <Icon className={cn("h-5 w-5", option.iconClassName)} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {option.title}
                  </p>
                  <p className="text-xs text-slate-500">{option.subtext}</p>
                </div>
              </a>
            );
          })}
        </PopoverContent>

        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={open ? "Close support menu" : "Open help and support"}
            aria-expanded={open}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-transform hover:bg-emerald-700 active:scale-95"
          >
            {open ? (
              <X className="h-6 w-6" />
            ) : (
              <MessageCircle className="h-6 w-6" />
            )}
          </button>
        </PopoverTrigger>
      </div>
    </Popover>
  );
}
