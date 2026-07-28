// src/lib/dietitian/logSlots.ts
// Feature: dietitian-management — Log_Slots for the Health_Log form (pure).
//
// A Log_Slot is the concrete, cadence-driven check-in a Dietitian is expected
// to record for a customer. Instead of offering a free calendar, the Log
// Customer workflow presents the fixed schedule implied by the Cadence_Engine
// (`src/lib/dietitian/cadence.ts`): starting from the Logging_Window start,
// every `cadenceInterval`-th Eligible_Day is a slot deadline. For a MEAL
// customer (interval 3) who started on 14 Jul with no paused days, the slots
// fall on 16, 19, 22, 25, 28 Jul, … — one slot per `pendingLogCount`, so the
// number of past-due slots always matches the list's "pending" counter.
//
// The module is PURE: dates are `YYYY-MM-DD` IST strings compared
// lexicographically and `today` is injected by the caller. "Logged" and
// "still editable" status is DB-derived and merged in by `buildLogSlots` via
// the sets the caller passes — nothing here performs I/O.
//
// Paused_Days are skipped when counting Eligible_Days, so a slot deadline can
// never land on a Paused_Day (and therefore a CREATE for a slot date can never
// hit the Paused_Day write-gate in HealthLogService).

import { addDaysToISODate } from "@/lib/dates/ist";
import { cadenceIntervalFor } from "@/lib/dietitian/cadence";
import type { CustomerCategory } from "@/types/dietitian";

/**
 * Everything needed to derive the slot schedule. Mirrors the cadence inputs so
 * the slots and the cadence counters can never drift apart.
 */
export interface LogSlotInput {
  category: CustomerCategory;
  /** Logging_Window start, YYYY-MM-DD (subscription `starts_on` / stay start). */
  windowStart: string;
  /** Logging_Window end (unclamped), YYYY-MM-DD (subscription/stay end). */
  windowEnd: string;
  /** Current IST calendar date, YYYY-MM-DD. */
  today: string;
  /** Paused IST dates for the governing subscription. */
  pausedDates: readonly string[];
}

export type LogSlotStatus = "logged" | "due" | "upcoming";

export interface LogSlot {
  /** 1-based slot number in schedule order. */
  index: number;
  /** The slot deadline — the `index * interval`-th Eligible_Day, YYYY-MM-DD. */
  date: string;
  status: LogSlotStatus;
  /**
   * Whether the Dietitian can act on the slot now: `true` for a past-due slot
   * (a CREATE is allowed) or a logged slot still inside its same-day edit
   * window; `false` for an upcoming slot (a future CREATE is rejected) or a
   * logged slot whose edit window has closed.
   */
  editable: boolean;
}

/** Membership sets a caller derives from the DB and hands to `buildLogSlots`. */
export interface LogSlotStatusSets {
  /** Slot dates that already carry a Dietitian_Log. */
  loggedDates: ReadonlySet<string>;
  /** Logged slot dates still inside their same-day edit window (Req 18.1/18.2). */
  editableLoggedDates: ReadonlySet<string>;
}

/**
 * The slot deadline dates for a Logging_Window, in schedule order.
 *
 * Walks every day of the window, counting only Eligible_Days (not Paused_Days),
 * and emits the date of each `interval`-th Eligible_Day up to `windowEnd`.
 */
export function slotDates(input: LogSlotInput): string[] {
  const interval = cadenceIntervalFor(input.category);
  const paused = new Set(input.pausedDates);
  const dates: string[] = [];

  let eligibleCount = 0;
  for (
    let date = input.windowStart;
    date <= input.windowEnd;
    date = addDaysToISODate(date, 1)
  ) {
    if (paused.has(date)) continue;
    eligibleCount += 1;
    if (eligibleCount % interval === 0) dates.push(date);
  }

  return dates;
}

/**
 * The full slot schedule with DB-derived status merged in.
 *
 * - `logged`   — a Dietitian_Log exists on the slot date. `editable` iff that
 *   log is still inside its same-day edit window.
 * - `due`      — no log yet and the deadline is on or before `today`; a CREATE
 *   is allowed, so `editable` is `true`.
 * - `upcoming` — the deadline is after `today`; a future CREATE is rejected, so
 *   `editable` is `false`.
 */
export function buildLogSlots(
  input: LogSlotInput,
  sets: LogSlotStatusSets,
): LogSlot[] {
  return slotDates(input).map((date, i) => {
    const index = i + 1;

    if (sets.loggedDates.has(date)) {
      return {
        index,
        date,
        status: "logged",
        editable: sets.editableLoggedDates.has(date),
      };
    }

    const isPast = date <= input.today;
    return {
      index,
      date,
      status: isPast ? "due" : "upcoming",
      editable: isPast,
    };
  });
}

/**
 * The slot the form should open on: the earliest actionable past-due slot,
 * else the most recent logged slot, else the earliest slot, else `null` when
 * there are no slots at all.
 */
export function defaultSlotDate(slots: readonly LogSlot[]): string | null {
  if (slots.length === 0) return null;

  const firstDue = slots.find((slot) => slot.status === "due");
  if (firstDue) return firstDue.date;

  const lastLogged = [...slots].reverse().find((slot) => slot.status === "logged");
  if (lastLogged) return lastLogged.date;

  return slots[0].date;
}
