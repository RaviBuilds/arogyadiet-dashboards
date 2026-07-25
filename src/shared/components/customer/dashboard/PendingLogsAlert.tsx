import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowRight,
  CalendarClock,
  AlertTriangle,
  Moon,
  CalendarDays,
  CalendarX,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PendingLogsAlert — the accountability moment of the KIT dashboard.
 *
 * Nobody watches a KIT customer eat: they alone confirm each day's meal, and
 * the dietitian can only guide them from those logs. So an unlogged day is not
 * a cosmetic gap, it is a break in care. This card makes that visible the
 * instant the customer lands on the dashboard — from the very first missed day
 * — and escalates its tone honestly:
 *
 *   1–2 missed days        amber nudge: your dietitian can't see these days
 *   3+ missed days         rose alert: our team will reach out to check on you
 *   window ended early     the meals they still have, and how to recover them
 *   3+ rest days in a row  a calm dietitian check-in notice
 *
 * Two things keep it honest rather than nagging. First, the fix lives inside
 * the card: `children` carries the inline logger, so the backlog is resolved
 * here instead of in a calendar hunt. Second, the recovery mechanic is stated
 * plainly — logging a day as rest pushes the kit end date out by one, so
 * telling the truth literally gives the customer their days back.
 */
type PendingLogsAlertProps = {
  /** Unlogged tracker dates strictly before today (yyyy-MM-dd, ascending). */
  pendingDates: string[];
  /** True when today itself is still unlogged. */
  todayPending?: boolean;
  /** Most recent date that carries a log, if any. */
  lastLoggedDate?: string | null;
  /** Consecutive FOOD_SKIPPED days ending at the most recent log. */
  restRun?: number;
  /** How many of the pending days the inline logger is showing. */
  shownCount?: number;
  /**
   * "backlog" — the kit window is still open.
   * "windowEnded" — the window's last day has passed while meals remain
   * unlogged. The full tracker closes in this state, so this card becomes the
   * customer's only way to recover those days and must not link away to it.
   */
  variant?: "backlog" | "windowEnded";
  /** Meals still unconsumed, used by the windowEnded copy. */
  mealsRemaining?: number;
  /** The date the kit window closed (windowEnded only). */
  windowEndDate?: string | null;
  trackerHref?: string;
  /** The inline logger rows. */
  children?: React.ReactNode;
  /** Reveal cascade offset, matched to the dashboard's choreography. */
  revealDelay?: string;
};

export function PendingLogsAlert({
  pendingDates,
  todayPending = false,
  lastLoggedDate,
  restRun = 0,
  shownCount,
  variant = "backlog",
  mealsRemaining = 0,
  windowEndDate,
  trackerHref = "/kit-tracker",
  children,
  revealDelay = "950ms",
}: PendingLogsAlertProps) {
  const count = pendingDates.length;
  const showRestNotice = restRun >= 3;
  const windowEnded = variant === "windowEnded";

  // Today alone is handled inside the Today's Focus card — don't repeat it.
  if (count === 0 && !showRestNotice && !windowEnded) return null;

  const urgent = windowEnded || count >= 3;
  const tone = urgent
    ? {
        section:
          "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-white",
        accent: "bg-gradient-to-r from-rose-400 to-rose-500",
        chip: "bg-rose-100 text-rose-700",
        halo: "bg-rose-400/25",
        icon: "bg-rose-500 text-white",
        eyebrow: "text-rose-700",
        Icon: windowEnded ? CalendarX : AlertTriangle,
      }
    : {
        section:
          "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white",
        accent: "bg-gradient-to-r from-amber-300 to-amber-500",
        chip: "bg-amber-100 text-amber-800",
        halo: "bg-amber-400/25",
        icon: "bg-amber-500 text-white",
        eyebrow: "text-amber-700",
        Icon: CalendarClock,
      };

  const Icon = tone.Icon;
  const hiddenCount = Math.max(0, count - (shownCount ?? count));

  const headline = windowEnded
    ? `Your kit window ended with ${mealsRemaining} ${mealsRemaining === 1 ? "meal" : "meals"} unlogged`
    : count === 0
      ? `${restRun} rest days in a row`
      : count === 1
        ? "1 day is waiting to be logged"
        : urgent
          ? `Your tracker is ${count} days behind`
          : `${count} days are waiting to be logged`;

  const body = windowEnded
    ? `Your ${windowEndDate ? `window closed on ${format(parseISO(windowEndDate), "d MMM")}` : "kit window has closed"}, but ${count > 0 ? "these days were never logged" : "days are still missing"}. Log them below — every day you mark as rest pushes your end date forward, so the meals you haven't eaten come back to you.`
    : count === 0
      ? "Resting is completely fine — your kit end date shifts automatically. Your dietitian may still call to check in and fine-tune your plan."
      : urgent
        ? "Your dietitian reads these logs to guide your plan, and right now those days are blank. Fill them in below — after three missed days our team reaches out to check on you."
        : count === 1
          ? "Log it below so your dietitian can see your progress and advise you correctly."
          : "These days are blank for your dietitian. Log them below so your progress stays visible and your guidance stays accurate.";

  return (
    <section
      className={cn(
        "reveal-rise relative overflow-hidden rounded-3xl border shadow-sm",
        tone.section,
      )}
      style={{ ["--reveal-delay" as string]: revealDelay }}
    >
      {/* Top accent — a thin, unmissable signal without shouting. */}
      <div className={cn("h-1 w-full", tone.accent)} />

      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:gap-6 sm:p-7">
        {/* Icon with a soft breathing halo: alive, never alarming. */}
        <div className="relative shrink-0">
          <span
            className={cn(
              "alert-halo absolute inset-0 rounded-full blur-md",
              tone.halo,
            )}
          />
          <span
            className={cn(
              "relative flex h-12 w-12 items-center justify-center rounded-full shadow-sm",
              tone.icon,
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.16em]",
                tone.eyebrow,
              )}
            >
              {windowEnded
                ? "Recover your days"
                : count === 0
                  ? "Dietitian check-in"
                  : "Action needed"}
            </p>
            {count > 0 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums",
                  tone.chip,
                )}
              >
                {count} {count === 1 ? "day" : "days"} unlogged
              </span>
            ) : null}
          </div>

          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {headline}
          </h3>

          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
            {body}
          </p>

          {/* The fix, in place. */}
          {children ? <div className="mt-5">{children}</div> : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* In the windowEnded state the full tracker shows an expiry
                message and cannot log, so linking there would be a dead end.
                Instead we tell the customer the next batch appears as they go. */}
            {windowEnded ? (
              hiddenCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
                  <Info className="h-4 w-4 shrink-0" />
                  {hiddenCount} more {hiddenCount === 1 ? "day" : "days"} will
                  appear here as you log these.
                </span>
              ) : null
            ) : hiddenCount > 0 ? (
              <Link
                href={trackerHref}
                className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 underline-offset-4 transition-colors hover:text-slate-900 hover:underline"
              >
                <CalendarDays className="h-4 w-4" />
                {hiddenCount} earlier {hiddenCount === 1 ? "day" : "days"} in
                the full tracker
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            ) : (
              <Link
                href={trackerHref}
                className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline"
              >
                <CalendarDays className="h-4 w-4" />
                Open full tracker
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            )}

            {lastLoggedDate ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <CalendarClock className="h-3.5 w-3.5" />
                Last logged {format(parseISO(lastLoggedDate), "EEE d MMM")}
              </span>
            ) : null}

            {todayPending && count > 0 && !windowEnded ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <CalendarClock className="h-3.5 w-3.5" />
                Today is included above
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* A long rest run is not a failure, but the dietitian is told about it —
          saying so here keeps the app honest. */}
      {showRestNotice && !windowEnded ? (
        <div className="flex items-start gap-3 border-t border-slate-900/[0.06] bg-white/70 px-6 py-4 sm:px-7">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Moon className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            You&apos;ve marked{" "}
            <span className="font-semibold text-slate-900">
              {restRun} days in a row
            </span>{" "}
            as rest days. That&apos;s allowed, and your dietitian may reach out
            to see how you&apos;re feeling.
          </p>
        </div>
      ) : null}

      {windowEnded ? (
        <div className="flex items-start gap-3 border-t border-slate-900/[0.06] bg-white/70 px-6 py-4 sm:px-7">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Info className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Your meals are not lost. Our team can see this kit is incomplete and
            will get in touch to help you finish it.
          </p>
        </div>
      ) : null}
    </section>
  );
}
