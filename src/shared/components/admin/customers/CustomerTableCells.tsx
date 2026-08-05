"use client";

// src/shared/components/admin/customers/CustomerTableCells.tsx
//
// Shared cell renderers, formatters, and column-filter builders for the three
// admin customer directories (Meal / KIT / Accommodation).
//
// All three tables render the same 9-column spine in the same order:
//
//   1. Customer Info   2. Contact          3. Diet & Allergy
//   4. Location        5. Status & Plan     6. Lifecycle  (category-specific)
//   7. Medical Record  8. Dietitian         9. Actions
//
// Column 5 always means "account / subscription state". Column 6 always means
// "category-specific fulfilment state plus its dates" — the single slot that
// varies between the three tables (Meal: plan period, KIT: shipment,
// Accommodation: stay). Everything else is byte-for-byte identical so the three
// directories can be read side by side.
//
// Every renderer here is presentational and pure. Filter predicates are pure
// too, so the sections can share both the dropdown options and the matching
// logic and can never drift apart.

import type { ReactNode } from "react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { AlertTriangle, Loader2, Navigation } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { clinicDisplayName } from "@/lib/clinic/visibility";
import { StatusBadge } from "../core/StatusBadge";
import type { ColumnFilterSection } from "../core/TableColumnFilter";
import type { CustomerData } from "./CustomerDashboard";

/** The single placeholder for every missing scalar value, in every table. */
export const EMPTY = "—";

/** Number of columns in the shared spine, for `colSpan` on empty/loading rows. */
export const CUSTOMER_TABLE_COLSPAN = 9;

/** Sentinel meaning "no filter applied" for every column filter below. */
export const FILTER_ALL = "ALL";

// ─── Shared scroll shell ──────────────────────────────────────────────────────
//
// Nine columns do not fit a laptop screen, so the table has to scroll sideways.
// Left to its own devices the scroll container grows to fit all 20 rows, which
// parks the horizontal scrollbar below the last row: to reach it you scroll the
// page to the bottom, and by then the column headers are long gone off the top.
//
// Bounding the container's height fixes both halves of that problem at once —
// the horizontal scrollbar sits directly under the visible rows, and the sticky
// header keeps the column names in view while scrolling in either direction.
// The 20 rows of a page are still all there, reached by scrolling inside the
// table rather than the page.

/**
 * Height budget for the scrolling row area. Viewport-relative so a small laptop
 * still shows a useful number of rows without pushing the horizontal scrollbar
 * off screen, with a floor for very short windows and a ceiling so large
 * monitors do not stretch the table past a comfortable reading height.
 */
export const CUSTOMER_TABLE_SCROLL_CONTAINER =
  "max-h-[clamp(340px,calc(100vh-270px),620px)] overflow-y-auto overscroll-contain";

/**
 * Floor width for the 9-column spine. Without it the columns squeeze until the
 * content wraps or truncates instead of producing a horizontal scrollbar.
 */
export const CUSTOMER_TABLE_MIN_WIDTH = "min-w-[1340px]";

/**
 * Pins the header row while the body scrolls. `position: sticky` is applied to
 * the `th` cells rather than the `thead`, which is what actually works on a
 * `border-collapse: collapse` table. The background must be fully opaque or the
 * rows show through as they pass underneath, and the bottom border is drawn as
 * an inset shadow because a collapsed border on a sticky cell gets clipped.
 */
export const CUSTOMER_TABLE_STICKY_HEADER =
  "[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-slate-50 [&_th]:shadow-[inset_0_-1px_0_rgb(226_232_240)]";

// ─── Formatters ────────────────────────────────────────────────────────────────

/** `04 Aug 2026`, or `null` when the input is missing/unparseable. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** `11 Jul 2026, 05:14 pm`, or `null` when the input is missing/unparseable. */
export function formatDateTime(iso: string | null | undefined): string | null {
  const datePart = formatDate(iso);
  if (!datePart) return null;
  const time = new Date(iso as string).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart}, ${time}`;
}

/** `15 Nights` / `1 Night` / `—`. */
export function formatNights(nights: number | null | undefined): string {
  if (nights == null || nights <= 0) return EMPTY;
  return `${nights} ${nights === 1 ? "Night" : "Nights"}`;
}

/**
 * Checkout is derived, not stored: `start_date + total_nights`. Returns `null`
 * when either input is missing.
 */
export function deriveCheckoutDate(
  startDate: string | null | undefined,
  totalNights: number | null | undefined,
): Date | null {
  if (!startDate || totalNights == null) return null;
  const date = new Date(startDate);
  if (isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + totalNights);
  return date;
}

/**
 * `F · 54 yrs`, or `F · Age —` when the date of birth was never captured, or
 * `— · Age —` when neither is known. Replaces the old unlabelled `( F - N/A )`,
 * which read as noise because nothing indicated the second value was an age.
 */
export function formatIdentityLine(
  gender: string | null | undefined,
  age: number | null | undefined,
): string {
  const genderPart =
    gender && gender !== "N/A" && gender.trim().length > 0
      ? gender.charAt(0).toUpperCase()
      : EMPTY;
  const agePart = age != null && age > 0 ? `${age} yrs` : `Age ${EMPTY}`;
  return `${genderPart} · ${agePart}`;
}

/** `Veg`/`Non-Veg` in the data, `VEG`/`NON_VEG` as stable filter values. */
export function normalizeDiet(preference: string | null | undefined): string {
  if (!preference) return "";
  return preference.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** True when the customer has a real allergy note (not blank, not "none"). */
export function hasAllergyNote(allergies: string | null | undefined): boolean {
  if (!allergies) return false;
  const trimmed = allergies.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== "none";
}

// ─── Column 1: Customer Info ──────────────────────────────────────────────────

const CATEGORY_BADGE: Record<string, { label: string; className: string }> = {
  KIT: { label: "KIT", className: "bg-orange-100 text-orange-700 hover:bg-orange-100" },
  ACCOMMODATION: { label: "STAY", className: "bg-teal-100 text-teal-700 hover:bg-teal-100" },
  MEAL: { label: "MEAL", className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" },
};

/**
 * Category chip shown on every row of every table, so a row stays
 * self-identifying when it is exported, screenshotted, or read out of context.
 * Anything that is not KIT/ACCOMMODATION is a meal subscriber.
 */
export function CustomerCategoryBadge({
  category,
}: {
  category: string | null | undefined;
}) {
  const config =
    (category ? CATEGORY_BADGE[category] : undefined) ?? CATEGORY_BADGE.MEAL;
  return (
    <Badge
      className={cn(
        "rounded-full border-0 px-2 text-[10px] font-semibold",
        config.className,
      )}
    >
      {config.label}
    </Badge>
  );
}

/**
 * Column 1. Name + category chip on line 1, identity on line 2.
 *
 * `showGps` is Meal-only: meal deliveries are route-optimized, so a missing
 * pin is an operational problem worth flagging inline. KIT ships by courier and
 * Accommodation customers are on-site, so neither has a route to optimize.
 */
export function CustomerInfoCell({
  customer,
  showGps = false,
}: {
  customer: CustomerData;
  showGps?: boolean;
}) {
  return (
    <TableCell>
      <div className="flex items-center gap-2">
        <span className="font-semibold tracking-tight text-slate-900">
          {customer.fullName}
        </span>
        <CustomerCategoryBadge category={customer.customerCategory} />
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-sm text-slate-500">
          {formatIdentityLine(customer.gender, customer.age)}
        </span>
        {showGps &&
          (customer.hasCoords ? (
            <span
              className="inline-flex items-center text-emerald-600"
              title="GPS coordinates available"
            >
              <Navigation className="h-2.5 w-2.5" />
              <span className="sr-only">GPS captured</span>
            </span>
          ) : (
            <span
              className="inline-flex items-center text-rose-500"
              title="No GPS coordinates"
            >
              <Navigation className="h-2.5 w-2.5" />
              <span className="sr-only">No GPS</span>
            </span>
          ))}
      </div>
    </TableCell>
  );
}

// ─── Column 2: Contact ────────────────────────────────────────────────────────

/** Column 2. Mobile on line 1, email on line 2 — on all three tables. */
export function ContactCell({ customer }: { customer: CustomerData }) {
  const email =
    customer.email && customer.email !== "N/A" ? customer.email : null;
  return (
    <TableCell>
      <div className="font-medium text-slate-900">
        {customer.mobile && customer.mobile !== "N/A" ? customer.mobile : EMPTY}
      </div>
      <div
        className="mt-0.5 max-w-[200px] truncate text-sm text-slate-500"
        title={email ?? undefined}
      >
        {email ?? EMPTY}
      </div>
    </TableCell>
  );
}

// ─── Column 3: Diet & Allergy ─────────────────────────────────────────────────

/**
 * Column 3. Colour-coded diet chip plus, when there is an allergy note, a
 * popover holding the full text. The popover (rather than truncated inline
 * text) means a long note is never silently cut off.
 */
export function DietAllergyCell({ customer }: { customer: CustomerData }) {
  const normalized = normalizeDiet(customer.dietary_preference);
  const label =
    !customer.dietary_preference || customer.dietary_preference === "N/A"
      ? "Not Set"
      : customer.dietary_preference;

  return (
    <TableCell>
      <div className="flex flex-col items-start gap-2">
        <Badge
          className={cn(
            "rounded-full border-0 px-2 text-[10px] font-semibold",
            normalized === "VEG"
              ? "bg-green-100 text-green-700 hover:bg-green-100"
              : normalized === "NON_VEG"
                ? "bg-red-100 text-red-700 hover:bg-red-100"
                : "bg-slate-100 text-slate-600 hover:bg-slate-100",
          )}
        >
          {label}
        </Badge>
        {hasAllergyNote(customer.allergies) && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 rounded-md border border-dashed border-amber-400 bg-transparent px-1.5 text-[10px] font-medium text-amber-700 underline decoration-dotted underline-offset-2 hover:bg-amber-50 hover:text-amber-800"
              >
                <AlertTriangle className="h-3 w-3" />
                View Allergy
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3 text-sm">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Allergies/Instructions:
              </p>
              <p className="text-muted-foreground">{customer.allergies}</p>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </TableCell>
  );
}

// ─── Column 4: Location ───────────────────────────────────────────────────────

/**
 * Column 4 for Meal and KIT — where the customer is served: delivery pincode
 * and the owning clinic.
 */
export function LocationCell({ customer }: { customer: CustomerData }) {
  const pincode =
    customer.primary_pincode && customer.primary_pincode !== "N/A"
      ? customer.primary_pincode
      : null;
  return (
    <TableCell>
      <span
        className={cn(
          "block text-xs",
          customer.clinicName ? "text-slate-600" : "font-medium text-amber-600",
        )}
      >
        {clinicDisplayName(customer.clinicName)}
      </span>
      <span className="mt-0.5 block font-mono text-xs text-slate-500">
        {pincode ?? EMPTY}
      </span>
    </TableCell>
  );
}

/**
 * Column 4 for Accommodation — the same "where the customer is served" idea,
 * but on-site: the stay unit (e.g. "Village Style Hut"). Accommodation captures
 * no delivery address, so pincode and clinic are both meaningless here; the
 * unit is the meaningful location.
 */
export function StayUnitCell({ unit }: { unit: string | null | undefined }) {
  return (
    <TableCell>
      {unit ? (
        <span className="text-sm text-slate-700">{unit}</span>
      ) : (
        <span className="text-sm italic text-slate-400">{EMPTY}</span>
      )}
    </TableCell>
  );
}

// ─── Column 5: Status & Plan ──────────────────────────────────────────────────

/**
 * Column 5. Account/subscription status badge on line 1, with a category
 * appropriate sub-line: the plan name for Meal and KIT, the stay length for
 * Accommodation (which has no package to name).
 */
export function StatusPlanCell({
  status,
  secondary,
}: {
  status: string;
  secondary: string;
}) {
  return (
    <TableCell>
      <StatusBadge
        status={status}
        variant={status === "Active" ? "solid" : "outline"}
      />
      <div className="mt-1.5 text-sm text-slate-500">{secondary}</div>
    </TableCell>
  );
}

// ─── Column 6: Lifecycle ──────────────────────────────────────────────────────

/**
 * Column 6. The one category-specific slot: a state badge on line 1 and the
 * dates that state refers to on line 2.
 *
 * `loading` shows a small inline spinner in this cell alone, because only this
 * column depends on a secondary fetch (shipment status / stay entries). The
 * rest of the row renders immediately from the customer list.
 */
export function LifecycleCell({
  badge,
  dates,
  loading = false,
}: {
  badge?: ReactNode;
  dates?: ReactNode;
  loading?: boolean;
}) {
  return (
    <TableCell>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : (
        <div className="flex flex-col gap-0.5">
          {badge}
          {dates}
        </div>
      )}
    </TableCell>
  );
}

/** `04 Aug 2026 → 19 Aug 2026`, degrading gracefully when either end is unknown. */
export function DateRangeLine({
  start,
  end,
}: {
  start: string | Date | null | undefined;
  end: string | Date | null | undefined;
}) {
  const startText = formatDate(
    start instanceof Date ? start.toISOString() : start,
  );
  const endText = formatDate(end instanceof Date ? end.toISOString() : end);

  let content: string;
  if (startText && endText) content = `${startText} → ${endText}`;
  else if (endText) content = `Ends ${endText}`;
  else if (startText) content = `From ${startText}`;
  else content = EMPTY;

  return <span className="text-xs text-slate-500">{content}</span>;
}

// ─── Column 7: Medical Record ─────────────────────────────────────────────────

/** Column 7. Same header and same two labels on all three tables. */
export function MedicalRecordCell({
  hasMedicalHistory,
}: {
  hasMedicalHistory: boolean;
}) {
  return (
    <TableCell>
      <Badge
        variant="outline"
        className={cn(
          "rounded-full px-2.5 text-xs",
          hasMedicalHistory
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-50 text-slate-500",
        )}
      >
        {hasMedicalHistory ? "Available" : "None"}
      </Badge>
    </TableCell>
  );
}

// ─── Column 8: Dietitian ──────────────────────────────────────────────────────

/** Column 8. Unassigned relations render italic, never blank. */
export function DietitianCell({
  dietitianName,
}: {
  dietitianName: string | null | undefined;
}) {
  return (
    <TableCell>
      <span
        className={cn(
          "text-sm",
          dietitianName ? "text-slate-700" : "italic text-slate-400",
        )}
      >
        {dietitianName || "Unassigned"}
      </span>
    </TableCell>
  );
}

// ─── Shared table states ──────────────────────────────────────────────────────

/** Identical empty state on all three tables. */
export function TableEmptyRow({
  icon: Icon,
  title,
  hint,
  colSpan = CUSTOMER_TABLE_COLSPAN,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  colSpan?: number;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-slate-500">
        <div className="flex flex-col items-center gap-1.5">
          <Icon className="h-8 w-8 text-slate-300" />
          <span className="text-sm font-medium text-slate-700">{title}</span>
          <span className="max-w-md text-xs text-slate-500">{hint}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Whole-table loading state. Reserved for when the row set itself is unknown —
 * never for enrichment data, which belongs in {@link LifecycleCell}'s inline
 * spinner so rows stay on screen.
 */
export function TableLoadingRow({
  label,
  colSpan = CUSTOMER_TABLE_COLSPAN,
}: {
  label: string;
  colSpan?: number;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-slate-500">
        <div className="flex flex-col items-center gap-1.5">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          <span className="text-sm text-slate-500">{label}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Column filters: options + matching predicates ────────────────────────────
//
// Each filter exposes its dropdown sections and its predicate from the same
// place. Previously the Meal table offered VEG / NON_VEG while the data holds
// "Veg" / "Non-Veg", and offered plan names that were compared against the
// status field — both silently matched nothing. Pairing options with predicates
// makes that class of bug impossible.

export const DIET_FILTER_ALLERGY = "ALLERGY";

/** Column 3 filter: diet plus the "has allergies" cut, on all three tables. */
export function dietAllergyFilterSections(): ColumnFilterSection[] {
  return [
    {
      label: "Filter by Diet",
      options: [
        { value: FILTER_ALL, label: "All Diets & Allergies" },
        { value: "VEG", label: "Vegetarian" },
        { value: "NON_VEG", label: "Non-Vegetarian" },
      ],
    },
    {
      label: "Filter by Allergy",
      options: [{ value: DIET_FILTER_ALLERGY, label: "Has Allergies" }],
    },
  ];
}

export function matchesDietAllergy(
  customer: CustomerData,
  filter: string,
): boolean {
  if (filter === FILTER_ALL) return true;
  if (filter === DIET_FILTER_ALLERGY) return hasAllergyNote(customer.allergies);
  return normalizeDiet(customer.dietary_preference) === filter;
}

/** The account/subscription statuses `CustomerData.status` can actually hold. */
export const CUSTOMER_STATUSES = [
  "Active",
  "Pending",
  "Stopped",
  "Expired",
  "No Plan",
] as const;

/**
 * Column 5 filter: the real statuses, plus a plan sub-list when plans exist.
 * Accommodation passes no plans, since a stay has no package.
 */
export function statusFilterSections(plans: string[] = []): ColumnFilterSection[] {
  const sections: ColumnFilterSection[] = [
    {
      label: "Filter by Status",
      options: [
        { value: FILTER_ALL, label: "All Statuses" },
        ...CUSTOMER_STATUSES.map((status) => ({ value: status, label: status })),
      ],
    },
  ];
  if (plans.length > 0) {
    sections.push({
      label: "Filter by Plan",
      options: plans.map((plan) => ({ value: `plan:${plan}`, label: plan })),
    });
  }
  return sections;
}

export function matchesStatus(customer: CustomerData, filter: string): boolean {
  if (filter === FILTER_ALL) return true;
  if (filter.startsWith("plan:")) {
    return customer.activePlanName === filter.slice("plan:".length);
  }
  return customer.status === filter;
}

/** Column 7 filter, identical on all three tables. */
export function medicalFilterSections(): ColumnFilterSection[] {
  return [
    {
      label: "Filter by Medical Record",
      options: [
        { value: FILTER_ALL, label: "All" },
        { value: "YES", label: "Has Medical Record" },
        { value: "NO", label: "No Medical Record" },
      ],
    },
  ];
}

export function matchesMedical(customer: CustomerData, filter: string): boolean {
  if (filter === FILTER_ALL) return true;
  return filter === "YES" ? customer.hasMedicalHistory : !customer.hasMedicalHistory;
}

export const DIETITIAN_FILTER_UNASSIGNED = "UNASSIGNED";

/** Column 8 filter, identical on all three tables. */
export function dietitianFilterSections(names: string[]): ColumnFilterSection[] {
  return [
    {
      label: "Filter by Dietitian",
      options: [
        { value: FILTER_ALL, label: "All Dietitians" },
        { value: DIETITIAN_FILTER_UNASSIGNED, label: "Unassigned" },
        ...names.map((name) => ({ value: name, label: name })),
      ],
    },
  ];
}

export function matchesDietitian(
  customer: CustomerData,
  filter: string,
): boolean {
  if (filter === FILTER_ALL) return true;
  if (filter === DIETITIAN_FILTER_UNASSIGNED) return !customer.dietitianName;
  return customer.dietitianName === filter;
}

/** Distinct, sorted dietitian names present in the given rows. */
export function collectDietitianNames(customers: CustomerData[]): string[] {
  const names = new Set<string>();
  for (const customer of customers) {
    if (customer.dietitianName) names.add(customer.dietitianName);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

// ─── Column 4 filter: data-quality toggles ────────────────────────────────────
//
// Multi-select rather than single-select so a clinic-scoped view can still be
// combined with "missing GPS" — the combination admins actually use when
// chasing down un-routable addresses in one clinic.

export const LOCATION_FILTER_UNASSIGNED_CLINIC = "UNASSIGNED_CLINIC";
export const LOCATION_FILTER_NO_GPS = "NO_GPS";

export function matchesLocationFlags(
  customer: CustomerData,
  flags: string[],
): boolean {
  if (flags.includes(LOCATION_FILTER_UNASSIGNED_CLINIC) && customer.clinic_id) {
    return false;
  }
  if (flags.includes(LOCATION_FILTER_NO_GPS) && customer.hasCoords) {
    return false;
  }
  return true;
}
