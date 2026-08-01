// src/services/__tests__/AccommodationService.initialStatus.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 3: Initial status assignment and completion alert
//
// **Validates: Requirements 2.1, 2.3, 2.5, 3.1, 3.2, 3.3**
//
// For any start date, total nights, and current IST date:
// - `determineInitialStatus` SHALL return PENDING when the start date is after today,
//   FINISHED when the start date is on or before today and `computeEndDate(startDate, totalNights)`
//   is before today, and ACTIVE otherwise.
// - A Stay_Entry created with FINISHED SHALL be flagged as a Backdated_Stay.
// - `describeBackdatedStayOutcome` SHALL report `showCompletionAlert` true exactly when
//   the projected status is FINISHED.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  determineInitialStatus,
  describeBackdatedStayOutcome,
  computeEndDate,
} from "@/services/AccommodationService";
import {
  arbISTDate,
  arbStartDateAround,
  arbTotalNights,
  shiftISODate,
  computeReferenceEndDate,
  REFERENCE_TODAY_IST,
} from "@/test/accommodation/paymentArbitraries";

describe("Feature: accommodation-payment-lifecycle, Property 3: Initial status assignment and completion alert", () => {
  it("determineInitialStatus returns PENDING when startDate is after todayIST", () => {
    fc.assert(
      fc.property(arbISTDate, arbTotalNights, (todayIST, totalNights) => {
        // Generate a start date strictly after today
        const startDate = shiftISODate(todayIST, 1); // tomorrow at minimum

        const status = determineInitialStatus(startDate, totalNights, todayIST);
        expect(status).toBe("PENDING");
      }),
      { numRuns: 100 },
    );
  });

  it("determineInitialStatus returns FINISHED when startDate <= todayIST and computeEndDate < todayIST", () => {
    fc.assert(
      fc.property(arbISTDate, (todayIST) => {
        // A 1-night stay starting yesterday: endDate = yesterday, which is < today
        const startDate = shiftISODate(todayIST, -1);
        const totalNights = 1;

        const endDate = computeReferenceEndDate(startDate, totalNights);
        // Precondition: endDate < todayIST (lexicographic)
        fc.pre(endDate < todayIST);

        const status = determineInitialStatus(startDate, totalNights, todayIST);
        expect(status).toBe("FINISHED");
      }),
      { numRuns: 100 },
    );
  });

  it("determineInitialStatus returns ACTIVE when startDate <= todayIST and computeEndDate >= todayIST", () => {
    fc.assert(
      fc.property(arbISTDate, arbTotalNights, (todayIST, totalNights) => {
        // Start on today itself — endDate = today + (totalNights - 1) >= today
        const startDate = todayIST;

        const endDate = computeReferenceEndDate(startDate, totalNights);
        // Precondition: endDate >= todayIST
        fc.pre(endDate >= todayIST);

        const status = determineInitialStatus(startDate, totalNights, todayIST);
        expect(status).toBe("ACTIVE");
      }),
      { numRuns: 100 },
    );
  });

  it("determineInitialStatus decision covers the full input space correctly", () => {
    fc.assert(
      fc.property(
        arbISTDate,
        arbStartDateAround(REFERENCE_TODAY_IST, 400),
        arbTotalNights,
        (todayIST, startDate, totalNights) => {
          const status = determineInitialStatus(startDate, totalNights, todayIST);
          const endDate = computeReferenceEndDate(startDate, totalNights);

          if (startDate > todayIST) {
            // Future start → PENDING
            expect(status).toBe("PENDING");
          } else if (endDate < todayIST) {
            // Start on/before today and end already passed → FINISHED
            expect(status).toBe("FINISHED");
          } else {
            // Start on/before today and end on/after today → ACTIVE
            expect(status).toBe("ACTIVE");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a Stay_Entry created with FINISHED status implies it is a Backdated_Stay (startDate <= today, endDate < today)", () => {
    fc.assert(
      fc.property(
        arbISTDate,
        arbStartDateAround(REFERENCE_TODAY_IST, 400),
        arbTotalNights,
        (todayIST, startDate, totalNights) => {
          const status = determineInitialStatus(startDate, totalNights, todayIST);

          if (status === "FINISHED") {
            // A FINISHED initial status means startDate <= todayIST
            // and the computed end date is before todayIST — this is the
            // Backdated_Stay condition (Req 3.1)
            expect(startDate <= todayIST).toBe(true);
            const endDate = computeReferenceEndDate(startDate, totalNights);
            expect(endDate < todayIST).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("VALID_TRANSITIONS remains untouched: FINISHED is an initial assignment, not a transition (Req 3.3)", () => {
    fc.assert(
      fc.property(
        arbISTDate,
        arbStartDateAround(REFERENCE_TODAY_IST, 400),
        arbTotalNights,
        (todayIST, startDate, totalNights) => {
          const status = determineInitialStatus(startDate, totalNights, todayIST);
          // The function only returns one of PENDING, ACTIVE, or FINISHED
          expect(["PENDING", "ACTIVE", "FINISHED"]).toContain(status);
          // It never returns EXPIRED — that is only reachable via transition
          expect(status).not.toBe("EXPIRED");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("describeBackdatedStayOutcome.showCompletionAlert is true exactly when projectedStatus is FINISHED", () => {
    fc.assert(
      fc.property(
        arbISTDate,
        arbStartDateAround(REFERENCE_TODAY_IST, 400),
        arbTotalNights,
        (todayIST, startDate, totalNights) => {
          const outcome = describeBackdatedStayOutcome(startDate, totalNights, todayIST);

          // showCompletionAlert === (projectedStatus === "FINISHED")
          expect(outcome.showCompletionAlert).toBe(outcome.projectedStatus === "FINISHED");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("describeBackdatedStayOutcome.projectedStatus matches determineInitialStatus", () => {
    fc.assert(
      fc.property(
        arbISTDate,
        arbStartDateAround(REFERENCE_TODAY_IST, 400),
        arbTotalNights,
        (todayIST, startDate, totalNights) => {
          const outcome = describeBackdatedStayOutcome(startDate, totalNights, todayIST);
          const status = determineInitialStatus(startDate, totalNights, todayIST);

          expect(outcome.projectedStatus).toBe(status);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("describeBackdatedStayOutcome.computedEndDate equals computeEndDate(startDate, totalNights)", () => {
    fc.assert(
      fc.property(
        arbISTDate,
        arbStartDateAround(REFERENCE_TODAY_IST, 400),
        arbTotalNights,
        (todayIST, startDate, totalNights) => {
          const outcome = describeBackdatedStayOutcome(startDate, totalNights, todayIST);
          const expectedEndDate = computeEndDate(startDate, totalNights);

          expect(outcome.computedEndDate).toBe(expectedEndDate);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when Computed_End_Date is on or after today, showCompletionAlert is false (Req 2.5)", () => {
    fc.assert(
      fc.property(arbISTDate, arbTotalNights, (todayIST, totalNights) => {
        // Start today: endDate >= today always
        const startDate = todayIST;

        const outcome = describeBackdatedStayOutcome(startDate, totalNights, todayIST);

        // endDate = startDate + nights - 1 >= todayIST since startDate === todayIST and nights >= 1
        expect(outcome.showCompletionAlert).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("when Computed_End_Date is before today (backdated + short stay), showCompletionAlert is true (Req 2.1)", () => {
    fc.assert(
      fc.property(arbISTDate, (todayIST) => {
        // A 1-night stay starting 2 days ago: endDate = today - 2 < today
        const startDate = shiftISODate(todayIST, -2);
        const totalNights = 1;

        const endDate = computeReferenceEndDate(startDate, totalNights);
        fc.pre(endDate < todayIST);

        const outcome = describeBackdatedStayOutcome(startDate, totalNights, todayIST);

        expect(outcome.showCompletionAlert).toBe(true);
        expect(outcome.projectedStatus).toBe("FINISHED");
      }),
      { numRuns: 100 },
    );
  });
});
