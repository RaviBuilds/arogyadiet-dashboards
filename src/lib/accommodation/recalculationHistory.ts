// src/lib/accommodation/recalculationHistory.ts
//
// Client-safe pure logic for building the Recalculation History list shown on
// the Accommodation tab, beside the existing Extension History card
// (accommodation-payment-lifecycle, Req 13.4, 13.5).
//
// Kept out of `AccommodationService.ts` (which imports repositories that pull in
// `createAdminClient()` / the Supabase service-role key) so this pure
// sort/project logic can be imported directly from the "use client"
// `StayRecalculationHistoryCard` without bundling server-only code into the
// client JS — the same pattern as `@/lib/accommodation/backdatedStay.ts` and
// `@/lib/accommodation/paymentHistory.ts`.
//
// Requirements: 13.4, 13.5

import type {
  StayRecalculation,
  RecalculationHistoryRow,
} from "@/types/accommodation";

/**
 * Builds an ordered list of recalculation history rows from a stay's recorded
 * Save_Stay_Details submissions. Purely informational — exactly like
 * `buildExtensionHistoryRows`, nothing derives a balance, a night count, or an
 * end date from these rows, and the two lists are never mixed in either
 * direction (Req 13.6, 13.7).
 *
 * Sorting: ascending by (recalculatedOn, createdAt) — oldest first, with the
 * creation timestamp as the tiebreaker for two submissions recorded on the same
 * date. Both fields are ISO strings, so lexicographic comparison is correct for
 * `YYYY-MM-DD` dates and ISO timestamps alike. The input array is never mutated.
 *
 * Each row projects:
 * - `id`: the Recalculation_History record id
 * - `date`: recalculatedOn (YYYY-MM-DD) for display
 * - `nightsBefore` / `nightsAfter`: total nights either side of the submission
 * - `totalAmountBefore` / `totalAmountAfter`: Total_Stay_Amount either side
 * - `endDateBefore` / `endDateAfter`: Computed_End_Date either side
 *
 * An empty input yields an empty array, which is what the card renders its
 * Req 13.4 empty state from — never null, never a throw.
 *
 * This is a pure function — no side effects or DB interaction.
 *
 * Requirements: 13.4, 13.5
 */
export function buildRecalculationHistoryRows(
  recalculations: readonly StayRecalculation[]
): RecalculationHistoryRow[] {
  // Sort a copy by (recalculatedOn, createdAt) ascending — oldest first
  const sorted = [...recalculations].sort((a, b) => {
    const dateCompare = a.recalculatedOn.localeCompare(b.recalculatedOn);
    if (dateCompare !== 0) return dateCompare;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return sorted.map((rec) => ({
    id: rec.id,
    date: rec.recalculatedOn,
    nightsBefore: rec.nightsBefore,
    nightsAfter: rec.nightsAfter,
    totalAmountBefore: rec.totalAmountBefore,
    totalAmountAfter: rec.totalAmountAfter,
    endDateBefore: rec.endDateBefore,
    endDateAfter: rec.endDateAfter,
  }));
}
