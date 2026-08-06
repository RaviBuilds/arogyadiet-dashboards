// src/services/__tests__/AccommodationService.recalculationDates.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 25: End-date and nights conversion is a faithful inverse pair within the picker bounds
//
// **Validates: Requirements 12.3, 12.8**
//
// For any valid (start, end) pair where end >= start, the endDateFromNights and
// nightsFromEndDate functions form a faithful inverse pair. The picker bounds
// returned by recalculationDateBounds are [startDate, computedEndDate], never
// empty, and collapse to a single date for a 1-night stay.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  nightsFromEndDate,
  endDateFromNights,
  recalculationDateBounds,
} from "@/services/AccommodationService";
import {
  arbISTDate,
  arbTotalNights,
  arbStayEntryWith,
  shiftISODate,
  computeReferenceEndDate,
} from "@/test/accommodation/paymentArbitraries";

describe("Feature: accommodation-payment-lifecycle, Property 25: End-date and nights conversion is a faithful inverse pair within the picker bounds", () => {
  it("inverse pair: endDateFromNights(start, nightsFromEndDate(start, end)) === end for any valid (start, end) where end >= start", () => {
    // Generate a start date and a non-negative offset to produce end >= start
    const arbStartAndEnd = arbISTDate.chain((start) =>
      fc
        .integer({ min: 0, max: 364 })
        .map((offset) => ({ start, end: shiftISODate(start, offset) })),
    );

    fc.assert(
      fc.property(arbStartAndEnd, ({ start, end }) => {
        const nights = nightsFromEndDate(start, end);
        const reconstructedEnd = endDateFromNights(start, nights);
        expect(reconstructedEnd).toBe(end);
      }),
      { numRuns: 100 },
    );
  });

  it("inverse pair (reverse): nightsFromEndDate(start, endDateFromNights(start, nights)) === nights for any start and nights >= 1", () => {
    fc.assert(
      fc.property(arbISTDate, arbTotalNights, (start, nights) => {
        const end = endDateFromNights(start, nights);
        const reconstructedNights = nightsFromEndDate(start, end);
        expect(reconstructedNights).toBe(nights);
      }),
      { numRuns: 100 },
    );
  });

  it("picker bounds never empty: recalculationDateBounds(stay).min <= recalculationDateBounds(stay).max", () => {
    fc.assert(
      fc.property(arbStayEntryWith(), (stay) => {
        const bounds = recalculationDateBounds(stay);
        // Lexicographic comparison on YYYY-MM-DD strings is date ordering
        expect(bounds.min <= bounds.max).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("picker bounds are [startDate, computedEndDate]: min is startDate, max is endDateFromNights(startDate, totalNights)", () => {
    fc.assert(
      fc.property(arbStayEntryWith(), (stay) => {
        const bounds = recalculationDateBounds(stay);
        const expectedMax = computeReferenceEndDate(
          stay.startDate,
          stay.totalNights,
        );

        expect(bounds.min).toBe(stay.startDate);
        expect(bounds.max).toBe(expectedMax);
      }),
      { numRuns: 100 },
    );
  });

  it("1-night stay: min === max === startDate", () => {
    // Use arbStayEntryWith with totalNights fixed to 1
    const arbOneNightStay = arbStayEntryWith({
      totalNights: fc.constant(1),
    });

    fc.assert(
      fc.property(arbOneNightStay, (stay) => {
        const bounds = recalculationDateBounds(stay);

        expect(bounds.min).toBe(stay.startDate);
        expect(bounds.max).toBe(stay.startDate);
        expect(bounds.min).toBe(bounds.max);
      }),
      { numRuns: 100 },
    );
  });
});
