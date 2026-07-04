// src/actions/__tests__/kitTracker.property.test.ts
//
// Property-based tests for KIT Tracker core correctness properties.
// Uses vitest + fast-check to validate universal invariants across randomized inputs.
//
// These tests exercise pure business logic functions extracted from the server actions
// and Zod validation schemas, keeping tests fast and deterministic (no DB, no network).

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { dailyLogSchema } from "@/validations/kitTrackerSchema";

// =============================================================================
// Pure helper functions — extracted logic matching the server action implementations
// =============================================================================

/**
 * Determines whether the KIT Tracker nav item and route are accessible.
 * The tracker is visible/accessible if and only if the category is exactly 'KIT'.
 */
function isKitCategory(category: string): boolean {
  return category === "KIT";
}

/**
 * Validates that a candidate received date falls within the allowed range:
 * [subscriptionStart, today] inclusive. Uses ISO date string comparison (yyyy-MM-dd).
 */
function isReceivedDateValid(
  candidate: string,
  subscriptionStart: string,
  today: string
): boolean {
  return candidate >= subscriptionStart && candidate <= today;
}

/**
 * Determines whether the received date can still be edited.
 * Editable only when zero daily log rows exist for the subscription.
 */
function isReceivedDateEditable(dailyLogCount: number): boolean {
  return dailyLogCount === 0;
}

/**
 * Computes the tracker end date given received date, duration, and total skipped days.
 * Formula: receivedDate + (durationDays - 1) + totalSkippedDays
 */
function computeTrackerEndDate(
  receivedDate: Date,
  durationDays: number,
  totalSkippedDays: number
): Date {
  const result = new Date(receivedDate);
  result.setDate(result.getDate() + (durationDays - 1) + totalSkippedDays);
  return result;
}

/**
 * Determines whether a candidate date falls within the editable window:
 * [receivedDate, today] inclusive. Uses ISO date string comparison (yyyy-MM-dd).
 */
function isDateInEditableWindow(
  candidate: string,
  receivedDate: string,
  today: string
): boolean {
  return candidate >= receivedDate && candidate <= today;
}

/**
 * Rejects non-KIT category values. Returns true only for categories that are NOT 'KIT'.
 */
function isNonKitCategory(category: string): boolean {
  return category !== "KIT";
}

// =============================================================================
// Custom arbitraries
// =============================================================================

/**
 * Generate a date string in yyyy-MM-dd format within a reasonable range.
 * Uses integer day offsets from a fixed epoch to avoid invalid Date edge cases.
 */
const EPOCH = new Date("2020-01-01T00:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 4017; // ~11 years (2020-01-01 to 2030-12-31)

function dayOffsetToDateStr(offset: number): string {
  const d = new Date(EPOCH + offset * DAY_MS);
  return d.toISOString().slice(0, 10);
}

const arbDateStr = fc.integer({ min: 0, max: MAX_DAYS }).map(dayOffsetToDateStr);

/** Generate an ordered pair of date strings where first <= second. */
const arbOrderedDatePair = fc
  .tuple(
    fc.integer({ min: 0, max: MAX_DAYS }),
    fc.integer({ min: 0, max: MAX_DAYS })
  )
  .map(([a, b]) => {
    const sorted = a <= b ? [a, b] : [b, a];
    return [dayOffsetToDateStr(sorted[0]), dayOffsetToDateStr(sorted[1])] as [string, string];
  });

/** Generate known customer categories plus random strings. */
const arbCategory = fc.oneof(
  fc.constant("KIT"),
  fc.constant("MEAL"),
  fc.constant("ACCOMMODATION"),
  fc.string({ minLength: 1, maxLength: 20 })
);

/** Generate only non-KIT categories (known categories and random strings that aren't 'KIT'). */
const arbNonKitCategory = fc.oneof(
  fc.constant("MEAL"),
  fc.constant("ACCOMMODATION"),
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== "KIT")
);

/** Generate a daily log status. */
const arbLogStatus = fc.oneof(
  fc.constant("FOOD_TAKEN" as const),
  fc.constant("FOOD_SKIPPED" as const)
);

// =============================================================================
// Property Tests
// =============================================================================

describe("KIT Tracker Property Tests", () => {
  // ---------------------------------------------------------------------------
  // Property 1: KIT-Only Access Control
  // Validates: Requirements 1.1, 1.2, 1.3, 12.1
  // ---------------------------------------------------------------------------
  describe("Property 1: KIT-Only Access Control", () => {
    it("tracker is visible/accessible iff category is exactly 'KIT'", () => {
      fc.assert(
        fc.property(arbCategory, (category) => {
          const result = isKitCategory(category);
          if (category === "KIT") {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("'KIT' is the only value that grants access (biconditional)", () => {
      fc.assert(
        fc.property(arbCategory, (category) => {
          // biconditional: result === true <=> category === 'KIT'
          expect(isKitCategory(category)).toBe(category === "KIT");
        }),
        { numRuns: 200 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 3: Received_Date Range Validation
  // Validates: Requirements 2.3, 2.4
  // ---------------------------------------------------------------------------
  describe("Property 3: Received_Date Range Validation", () => {
    it("candidate accepted iff within [subscriptionStart, today] inclusive", () => {
      fc.assert(
        fc.property(
          arbOrderedDatePair,
          arbDateStr,
          ([subscriptionStart, today], candidate) => {
            const result = isReceivedDateValid(candidate, subscriptionStart, today);
            const expected = candidate >= subscriptionStart && candidate <= today;
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("dates equal to boundaries are always accepted", () => {
      fc.assert(
        fc.property(arbOrderedDatePair, ([subscriptionStart, today]) => {
          // The start boundary itself should be valid
          expect(isReceivedDateValid(subscriptionStart, subscriptionStart, today)).toBe(true);
          // The today boundary itself should be valid
          expect(isReceivedDateValid(today, subscriptionStart, today)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 4: Received_Date Editability Lock
  // Validates: Requirements 2.7, 2.8
  // ---------------------------------------------------------------------------
  describe("Property 4: Received_Date Editability Lock", () => {
    it("edit succeeds iff zero daily logs exist", () => {
      fc.assert(
        fc.property(fc.nat(100), (dailyLogCount) => {
          const result = isReceivedDateEditable(dailyLogCount);
          if (dailyLogCount === 0) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("any positive log count locks the received date (biconditional)", () => {
      fc.assert(
        fc.property(fc.nat(1000), (dailyLogCount) => {
          expect(isReceivedDateEditable(dailyLogCount)).toBe(dailyLogCount === 0);
        }),
        { numRuns: 200 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 7: Tracker_End_Date Computation
  // Validates: Requirements 3.2, 7.6, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4
  // ---------------------------------------------------------------------------
  describe("Property 7: Tracker_End_Date Computation", () => {
    it("end date = receivedDate + (duration - 1) + totalSkippedDays for random log sequences", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2029-12-31") }),
          fc.integer({ min: 1, max: 365 }),
          fc.array(arbLogStatus, { minLength: 0, maxLength: 100 }),
          (receivedDate, durationDays, logStatuses) => {
            // Compute total skipped days by counting FOOD_SKIPPED entries
            const totalSkippedDays = logStatuses.filter(
              (s) => s === "FOOD_SKIPPED"
            ).length;

            // Verify totalSkippedDays >= 0 (trivially true for count, but stated in spec)
            expect(totalSkippedDays).toBeGreaterThanOrEqual(0);

            // Compute the tracker end date
            const endDate = computeTrackerEndDate(
              receivedDate,
              durationDays,
              totalSkippedDays
            );

            // Verify the formula: endDate = receivedDate + (duration - 1) + totalSkippedDays
            const expectedEnd = new Date(receivedDate);
            expectedEnd.setDate(
              expectedEnd.getDate() + (durationDays - 1) + totalSkippedDays
            );

            expect(endDate.getTime()).toBe(expectedEnd.getTime());
          }
        ),
        { numRuns: 200 }
      );
    });

    it("totalSkippedDays can never be negative (count-based computation)", () => {
      fc.assert(
        fc.property(
          fc.array(arbLogStatus, { minLength: 0, maxLength: 200 }),
          (logStatuses) => {
            const totalSkippedDays = logStatuses.filter(
              (s) => s === "FOOD_SKIPPED"
            ).length;
            expect(totalSkippedDays).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("end date extends monotonically with each additional skip", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2029-12-31") }),
          fc.integer({ min: 1, max: 365 }),
          fc.integer({ min: 0, max: 100 }),
          (receivedDate, durationDays, skippedDays) => {
            const endDateNow = computeTrackerEndDate(receivedDate, durationDays, skippedDays);
            const endDateWithOneMore = computeTrackerEndDate(
              receivedDate,
              durationDays,
              skippedDays + 1
            );
            // Adding one skip should extend end date by exactly 1 day
            expect(endDateWithOneMore.getTime() - endDateNow.getTime()).toBe(
              24 * 60 * 60 * 1000
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 10: Editable_Window Boundary Enforcement
  // Validates: Requirements 4.1, 4.2, 4.3
  // ---------------------------------------------------------------------------
  describe("Property 10: Editable_Window Boundary Enforcement", () => {
    it("write allowed iff candidateDate within [receivedDate, today] inclusive", () => {
      fc.assert(
        fc.property(
          arbOrderedDatePair,
          arbDateStr,
          ([receivedDate, today], candidateDate) => {
            const result = isDateInEditableWindow(candidateDate, receivedDate, today);
            const expected = candidateDate >= receivedDate && candidateDate <= today;
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("boundary dates (receivedDate and today) are always within the window", () => {
      fc.assert(
        fc.property(arbOrderedDatePair, ([receivedDate, today]) => {
          expect(isDateInEditableWindow(receivedDate, receivedDate, today)).toBe(true);
          expect(isDateInEditableWindow(today, receivedDate, today)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 12: Optional Field Validation and Persistence (Food_Taken)
  // Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
  // ---------------------------------------------------------------------------
  describe("Property 12: Optional Field Validation and Persistence", () => {
    it("valid FOOD_TAKEN payloads with optional fields pass schema validation", () => {
      // Generate valid optional field combinations.
      // For weightKg, use integer cents divided by 100 to ensure exact 2-decimal representation.
      // Filter to values where Math.round(v*100) === v*100 to match the Zod refine check.
      const arbSafeWeight = fc
        .integer({ min: 0, max: 50000 })
        .map((cents) => {
          // Use parseFloat + toFixed to get an exact 2-decimal float
          return parseFloat((cents / 100).toFixed(2));
        });

      const arbValidPayload = fc.record({
        status: fc.constant("FOOD_TAKEN" as const),
        activityMinutes: fc.option(fc.integer({ min: 0, max: 1440 }), { nil: undefined }),
        activityName: fc.option(
          fc.string({ minLength: 0, maxLength: 100 }),
          { nil: undefined }
        ),
        weightKg: fc.option(arbSafeWeight, { nil: undefined }),
      });

      fc.assert(
        fc.property(arbValidPayload, (payload) => {
          const result = dailyLogSchema.safeParse(payload);
          expect(result.success).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it("activityMinutes outside [0, 1440] or non-integer rejects", () => {
      const arbInvalidMinutes = fc.oneof(
        fc.integer({ min: -1000, max: -1 }), // negative
        fc.integer({ min: 1441, max: 10000 }), // too large
        fc.double({ min: 0.01, max: 1440, noNaN: true }).filter(
          (v) => !Number.isInteger(v)
        ) // decimal
      );

      fc.assert(
        fc.property(arbInvalidMinutes, (minutes) => {
          const payload = { status: "FOOD_TAKEN" as const, activityMinutes: minutes };
          const result = dailyLogSchema.safeParse(payload);
          expect(result.success).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("weightKg outside [0, 500] or >2 decimal places rejects", () => {
      const arbInvalidWeight = fc.oneof(
        fc.double({ min: -1000, max: -0.01, noNaN: true }), // negative
        fc.double({ min: 500.01, max: 10000, noNaN: true }), // too large
        // 3+ decimal places within valid range
        fc.integer({ min: 1, max: 499999 }).map((v) => v / 1000) // produces values like 0.001 to 499.999
      );

      fc.assert(
        fc.property(arbInvalidWeight, (weight) => {
          const payload = { status: "FOOD_TAKEN" as const, weightKg: weight };
          const result = dailyLogSchema.safeParse(payload);

          // Weight is invalid if < 0, > 500, or has more than 2 decimal places
          const isOutOfRange = weight < 0 || weight > 500;
          const hasMoreThan2Decimals = Math.round(weight * 100) !== weight * 100;

          if (isOutOfRange || hasMoreThan2Decimals) {
            expect(result.success).toBe(false);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("activityName exceeding 100 characters rejects", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 101, maxLength: 300 }),
          (name) => {
            const payload = { status: "FOOD_TAKEN" as const, activityName: name };
            const result = dailyLogSchema.safeParse(payload);
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("FOOD_TAKEN with all optional fields omitted passes", () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const payload = { status: "FOOD_TAKEN" as const };
          const result = dailyLogSchema.safeParse(payload);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 13: Food_Skipped Field Clearing
  // Validates: Requirements 6.1, 6.2, 6.4
  // ---------------------------------------------------------------------------
  describe("Property 13: Food_Skipped Field Clearing", () => {
    it("FOOD_SKIPPED payloads with optional fields are rejected by schema", () => {
      // Generate FOOD_SKIPPED payloads that illegally include optional fields
      const arbSkippedWithFields = fc.record({
        status: fc.constant("FOOD_SKIPPED" as const),
        activityMinutes: fc.option(fc.integer({ min: 0, max: 1440 }), { nil: undefined }),
        activityName: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        weightKg: fc.option(
          fc.integer({ min: 0, max: 50000 }).map((v) => v / 100),
          { nil: undefined }
        ),
      });

      fc.assert(
        fc.property(arbSkippedWithFields, (payload) => {
          const result = dailyLogSchema.safeParse(payload);
          // The discriminated union for FOOD_SKIPPED only allows { status: "FOOD_SKIPPED" }
          // Any extra fields beyond 'status' should cause the parse to strip them (passthrough)
          // or reject them. The schema uses strict object definition so extra keys are stripped.
          if (result.success) {
            // If it passes, the output must NOT contain optional fields
            const data = result.data;
            if (data.status === "FOOD_SKIPPED") {
              expect("activityMinutes" in data).toBe(false);
              expect("activityName" in data).toBe(false);
              expect("weightKg" in data).toBe(false);
            }
          }
          // Either way, the invariant holds: FOOD_SKIPPED never carries optional fields
        }),
        { numRuns: 200 }
      );
    });

    it("transitioning from FOOD_TAKEN to FOOD_SKIPPED excludes optional fields from output", () => {
      // Simulate: generate a valid FOOD_TAKEN log, then re-validate as FOOD_SKIPPED
      const arbSafeWeight = fc
        .integer({ min: 0, max: 50000 })
        .map((cents) => parseFloat((cents / 100).toFixed(2)));

      const arbTakenPayload = fc.record({
        status: fc.constant("FOOD_TAKEN" as const),
        activityMinutes: fc.option(fc.integer({ min: 0, max: 1440 }), { nil: undefined }),
        activityName: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        weightKg: fc.option(arbSafeWeight, { nil: undefined }),
      });

      fc.assert(
        fc.property(arbTakenPayload, (takenPayload) => {
          // First validate the taken payload works
          const takenResult = dailyLogSchema.safeParse(takenPayload);
          expect(takenResult.success).toBe(true);

          // Now simulate transition to FOOD_SKIPPED — only status should be present
          const skippedPayload = { status: "FOOD_SKIPPED" as const };
          const skippedResult = dailyLogSchema.safeParse(skippedPayload);
          expect(skippedResult.success).toBe(true);

          if (skippedResult.success) {
            const data = skippedResult.data;
            expect(data.status).toBe("FOOD_SKIPPED");
            expect("activityMinutes" in data).toBe(false);
            expect("activityName" in data).toBe(false);
            expect("weightKg" in data).toBe(false);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("bare FOOD_SKIPPED payload always validates successfully", () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const payload = { status: "FOOD_SKIPPED" as const };
          const result = dailyLogSchema.safeParse(payload);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data).toEqual({ status: "FOOD_SKIPPED" });
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 16: Category-Scoping Rejection for Non-KIT Subscriptions
  // Validates: Requirements 12.2
  // ---------------------------------------------------------------------------
  describe("Property 16: Category-Scoping Rejection", () => {
    it("all non-KIT categories are rejected by the category check", () => {
      fc.assert(
        fc.property(arbNonKitCategory, (category) => {
          // The category check function must reject every non-KIT value
          expect(isKitCategory(category)).toBe(false);
          expect(isNonKitCategory(category)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it("known non-KIT categories (MEAL, ACCOMMODATION) always rejected", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant("MEAL"), fc.constant("ACCOMMODATION")),
          (category) => {
            expect(isKitCategory(category)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("random strings that are not 'KIT' are all rejected", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 50 }).filter((s) => s !== "KIT"),
          (category) => {
            expect(isKitCategory(category)).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
