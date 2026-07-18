import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  PackageX,
  PauseCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { StatusPill, type StatusPillTone } from "@/shared/components/customer/profile-ui/StatusPill";

/**
 * CurrentSubscriptionCard — the premium "story chapter 2" summary that
 * replaces the old flat white rectangle on /subscription.
 *
 * Uses ONLY the fields already fetched by the page (subscription row + the
 * matched plan name). No new queries, no invented values — if a field isn't
 * available it's hidden gracefully rather than showing a fake placeholder.
 *
 * Status → visual language mapping mirrors the tone conventions already
 * used across the customer portal (KitHistoryTable, StayHistoryTable):
 * ACTIVE = emerald, PENDING = amber, STOPPED/PAUSED = slate, EXPIRED/
 * CANCELLED = a quieter red-tinted slate (never alarming, just closed).
 */
type SubscriptionStatus =
  | "ACTIVE"
  | "PENDING"
  | "STOPPED"
  | "EXPIRED"
  | "CANCELLED"
  | string;

const STATUS_VISUALS: Record<
  string,
  { label: string; tone: StatusPillTone; icon: typeof CheckCircle2 }
> = {
  ACTIVE: { label: "Active", tone: "green", icon: CheckCircle2 },
  PENDING: { label: "Pending", tone: "amber", icon: Clock },
  STOPPED: { label: "Paused", tone: "slate", icon: PauseCircle },
  EXPIRED: { label: "Expired", tone: "slate", icon: Clock },
  CANCELLED: { label: "Cancelled", tone: "red", icon: XCircle },
};

function getStatusVisual(status: string) {
  return (
    STATUS_VISUALS[status] ?? { label: status || "Unknown", tone: "slate" as StatusPillTone, icon: Clock }
  );
}

function formatDate(value: string | null, formatFn: (v: string) => string): string | null {
  if (!value) return null;
  try {
    return formatFn(value);
  } catch {
    return null;
  }
}

export function CurrentSubscriptionCard({
  planName,
  status,
  startsOn,
  endsOn,
  subscriptionCode,
  totalDays,
  journeyDay,
  formatFn,
}: {
  planName: string;
  status: SubscriptionStatus;
  startsOn: string | null;
  endsOn: string | null;
  subscriptionCode: string | null;
  totalDays: number | null;
  /** Current day-in-journey (1-based), computed by the page with the exact
   * same differenceInCalendarDays formula as the Dashboard's JourneyHeader —
   * kept as a prop so this component stays free of date-fns coupling and
   * can never drift from the Dashboard's numbers. */
  journeyDay: number | null;
  formatFn: (value: string) => string;
}) {
  const visual = getStatusVisual(status);
  const startLabel = formatDate(startsOn, formatFn);
  const endLabel = formatDate(endsOn, formatFn);

  const showProgress =
    typeof totalDays === "number" &&
    totalDays > 0 &&
    typeof journeyDay === "number" &&
    journeyDay > 0;
  // Same convention as the Dashboard: progress reflects the current day in
  // the journey (journeyDay/totalDays), not merely "days fully completed" —
  // so "Day 22 of 41" on the Dashboard and "54%" here always agree.
  const progress = showProgress
    ? Math.max(0, Math.min(100, Math.round((journeyDay! / totalDays!) * 100)))
    : 0;
  const daysCompleted = showProgress ? Math.max(0, journeyDay! - 1) : null;
  const daysRemaining = showProgress
    ? Math.max(0, totalDays! - journeyDay!)
    : null;

  return (
    <section
      className="reveal-rise relative overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-white via-white to-emerald-50/40 shadow-sm"
      style={{ ["--reveal-delay" as string]: "150ms" }}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-emerald-100/50 blur-3xl" />

      <div className="relative p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <IconChip icon={CalendarDays} tone="green" size="lg" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Current Plan
              </p>
              <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {planName}
              </h2>
              {subscriptionCode ? (
                <p className="mt-1 font-mono text-xs text-slate-400">
                  {subscriptionCode}
                </p>
              ) : null}
            </div>
          </div>

          <StatusPill icon={visual.icon} tone={visual.tone} className="shrink-0 self-start">
            {visual.label}
          </StatusPill>
        </div>

        {(startLabel || endLabel || daysRemaining !== null) && (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:gap-10">
            {startLabel ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Start Date
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {startLabel}
                </p>
              </div>
            ) : null}
            {endLabel ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  End Date
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {endLabel}
                </p>
              </div>
            ) : null}
            {daysRemaining !== null ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Days Remaining
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {daysRemaining} {daysRemaining === 1 ? "day" : "days"}
                </p>
              </div>
            ) : null}
          </div>
        )}

        {showProgress ? (
          <div className="mt-6">
            <div className="flex items-baseline justify-between text-xs font-medium text-slate-500">
              <span>
                {daysCompleted} of {totalDays} days completed
              </span>
              <span className="text-slate-400">{progress}%</span>
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-emerald-900/10"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${daysCompleted} of ${totalDays} days completed, ${progress}%`}
            >
              <div
                className="journey-bar-anim h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-5 border-t border-slate-100 pt-5">
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 transition-colors hover:text-emerald-800"
          >
            View Subscription Details
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * NoSubscriptionCard — premium empty state for when the customer has no
 * subscription attached yet. Replaces the plain Alert with something that
 * feels intentional rather than an error.
 */
export function NoSubscriptionCard() {
  return (
    <section
      className={cn(
        "reveal-rise flex flex-col items-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-sm sm:py-12",
      )}
      style={{ ["--reveal-delay" as string]: "150ms" }}
    >
      <IconChip icon={PackageX} tone="slate" size="lg" />
      <h2 className="text-lg font-semibold text-slate-900">
        No subscription found
      </h2>
      <p className="max-w-md text-sm leading-relaxed text-slate-500">
        We couldn&apos;t find a subscription attached to your account. Choose
        a plan below to get started, or contact the clinic if you believe
        this is a mistake.
      </p>
    </section>
  );
}
