// src/lib/onboarding/__tests__/sections.property.test.ts
// Feature: customer-mobile-onboarding, Property 8: Dashboard section partition
//
// Property 8: Dashboard section partition
// For any set of Customer_Records, each record appears in exactly one admin
// section (IN_PROGRESS → "Onboarded"; COMPLETED → "Onboarding Completed").
// A status transition moves a record from one section to the other and never
// duplicates or drops it.
//
// Validates: Requirements 6.11

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ONBOARDING_STATUSES,
  sectionForStatus,
  partitionBySection,
  type OnboardingStatus,
} from "@/lib/onboarding/sections";

// ─── Arbitrary generators ───────────────────────────────────────────────────
// A Customer_Record is modelled by a stable unique id plus its onboarding
// status; only the status affects which section it belongs in.

const arbStatus: fc.Arbitrary<OnboardingStatus> =
  fc.constantFrom(...ONBOARDING_STATUSES);

interface Record {
  id: number;
  onboardingStatus: OnboardingStatus;
}

// Generate a set of records with unique ids (so we can reason about "no
// duplicates" and "no drops" by comparing id sets).
const arbRecordSet: fc.Arbitrary<Record[]> = fc
  .array(arbStatus, { minLength: 0, maxLength: 50 })
  .map((statuses) =>
    statuses.map((onboardingStatus, id) => ({ id, onboardingStatus })),
  );

// ─── Property Test ──────────────────────────────────────────────────────────

describe("Property 8: Dashboard section partition", () => {
  it("maps each status to exactly one section (total, deterministic)", () => {
    fc.assert(
      fc.property(arbStatus, (status) => {
        const section = sectionForStatus(status);
        // IN_PROGRESS → Onboarded, COMPLETED → Onboarding Completed (Req 6.9/6.10).
        const expected =
          status === "IN_PROGRESS" ? "ONBOARDED" : "ONBOARDING_COMPLETED";
        expect(section).toBe(expected);
      }),
      { numRuns: 25 },
    );
  });

  it("partitions every record into exactly one section — no duplicates, no drops", () => {
    fc.assert(
      fc.property(arbRecordSet, (records) => {
        const { onboarded, onboardingCompleted } = partitionBySection(records);

        const onboardedIds = onboarded.map((r) => r.id);
        const completedIds = onboardingCompleted.map((r) => r.id);

        // No drops / no duplicates: the two buckets partition the input exactly.
        expect(onboardedIds.length + completedIds.length).toBe(records.length);

        // Disjoint: no id appears in both sections.
        const overlap = onboardedIds.filter((id) => completedIds.includes(id));
        expect(overlap).toEqual([]);

        // Cover: union of bucket ids equals the input id set.
        const union = new Set([...onboardedIds, ...completedIds]);
        expect(union).toEqual(new Set(records.map((r) => r.id)));

        // Correct placement: each bucket matches its status.
        expect(onboarded.every((r) => r.onboardingStatus === "IN_PROGRESS")).toBe(true);
        expect(
          onboardingCompleted.every((r) => r.onboardingStatus === "COMPLETED"),
        ).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it("a status transition moves a record between sections without duplicating or dropping it", () => {
    fc.assert(
      fc.property(arbRecordSet, fc.nat(), (records, pickSeed) => {
        fc.pre(records.length > 0);

        const index = pickSeed % records.length;
        const target = records[index];
        const originalSection = sectionForStatus(target.onboardingStatus);

        // Transition the picked record to the opposite status.
        const newStatus: OnboardingStatus =
          target.onboardingStatus === "IN_PROGRESS" ? "COMPLETED" : "IN_PROGRESS";
        const transitioned = records.map((r, i) =>
          i === index ? { ...r, onboardingStatus: newStatus } : r,
        );

        const before = partitionBySection(records);
        const after = partitionBySection(transitioned);

        // Total count is preserved (no duplicate, no drop).
        expect(after.onboarded.length + after.onboardingCompleted.length).toBe(
          records.length,
        );

        // The record left its original section and joined the other one.
        const newSection = sectionForStatus(newStatus);
        expect(newSection).not.toBe(originalSection);

        const inOnboardedBefore = before.onboarded.some((r) => r.id === target.id);
        const inOnboardedAfter = after.onboarded.some((r) => r.id === target.id);
        // Membership in the "onboarded" bucket flipped for the transitioned record.
        expect(inOnboardedAfter).toBe(!inOnboardedBefore);

        // It appears in exactly one bucket afterwards (never both, never neither).
        const appearances =
          (after.onboarded.filter((r) => r.id === target.id).length) +
          (after.onboardingCompleted.filter((r) => r.id === target.id).length);
        expect(appearances).toBe(1);
      }),
      { numRuns: 25 },
    );
  });
});
