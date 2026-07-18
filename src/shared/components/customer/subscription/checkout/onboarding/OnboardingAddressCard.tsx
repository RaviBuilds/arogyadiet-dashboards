import { Check, Home } from "lucide-react";
import { StatusPill } from "@/shared/components/customer/profile-ui/StatusPill";
import { cn } from "@/lib/utils";

/**
 * Joins the address parts into one clean line. Some stored `street_1`
 * values already end in a trailing comma (e.g. "Aparna Elixir,"), which
 * previously produced an ugly double-comma once this component appended
 * its own separator. This trims stray trailing punctuation/whitespace from
 * each part and drops empty parts before joining — a display-only fix, the
 * underlying address fields are never modified.
 */
function formatAddressLine(address: OnboardingAddressData): string {
  return [address.street_1, address.street_2, address.city, address.pincode]
    .map((part) => part?.trim().replace(/[,\s]+$/, ""))
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

/**
 * OnboardingAddressCard — redesigned selectable delivery address card for
 * Step 2 of checkout. Same fields as the original Card in step-2-delivery
 * (tag, is_primary, street/city/pincode) — this only changes presentation:
 * large rounded corners, soft shadow, elegant green-glow selection instead
 * of a thick colored ring, matching the language established in Step 1's
 * plan/food preference cards.
 */
export type OnboardingAddressData = {
  id: string;
  tag: string | null;
  is_primary?: boolean | null;
  street_1: string | null;
  street_2?: string | null;
  city: string | null;
  pincode: string | null;
};

export function OnboardingAddressCard({
  address,
  isSelected,
  onSelect,
}: {
  address: OnboardingAddressData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "group relative flex items-start gap-3.5 rounded-3xl border bg-white p-5 text-left shadow-sm transition-all duration-300",
        "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
        isSelected
          ? "-translate-y-0.5 border-emerald-400 bg-emerald-50/40 shadow-md ring-2 ring-emerald-200"
          : "border-slate-200 hover:border-emerald-200",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
          isSelected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
        )}
      >
        <Home className="h-5 w-5" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">
            {address.tag || "Address"}
          </p>
          {address.is_primary ? (
            <StatusPill tone="green" className="px-2 py-0.5 text-[0.6rem]">
              Primary
            </StatusPill>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-500">
          {formatAddressLine(address)}
        </p>
      </div>

      {isSelected ? (
        <span className="absolute right-4 top-4 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white animate-in zoom-in-50 duration-200">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}
