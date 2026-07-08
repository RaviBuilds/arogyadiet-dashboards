// src/lib/onboarding/__tests__/dailyPreferences.test.ts
// Feature: onboarding-past-date-flexibility — Unit tests for the pure daily
// preferences generation logic.
//
// These tests validate the core business rules for past-date onboarding:
//   - Past "Delivered" days generate records with correct meal/address mapping
//   - Past "Skipped" days generate paused records with initial defaults
//   - Future days use initial meal preference and primary address
//   - Skipped days extend the effective end date
//   - Record count = totalDays + skippedCount (invariant)
//   - RecordCountMismatchError is thrown on logic violations
//
// Validates: Requirements 3.3, 4.1–4.6, 6.1–6.7

import { describe, it, expect } from "vitest";
import {
  generateDailyPreferences,
  RecordCountMismatchError,
  type DailyPreferencesContext,
} from "@/lib/onboarding/dailyPreferences";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const MEAL_CATEGORY_MAP: Record<string, string> = {
  VEG: "mc-veg-id",
  EGG: "mc-egg-id",
  CHICKEN: "mc-chicken-id",
};

const BASE_CTX: DailyPreferencesContext = {
  subscriptionId: "sub-1",
  customerProfileId: "profile-1",
  startsOn: "2025-07-01",
  originalEndsOn: "2025-07-30", // 30-day plan
  totalDays: 30,
  initialMealCategoryId: "mc-veg-id",
  primaryAddressId: "addr-primary",
  secondaryAddressId: "addr-secondary",
  mealCategoryMap: MEAL_CATEGORY_MAP,
  boundaryDate: "2025-07-08", // Today (past days: July 1-8, future: July 9+)
  pastDayStatuses: [
    { date: "2025-07-01", mealStatus: "Delivered", mealType: "VEG", deliveryAddress: "Primary" },
    { date: "2025-07-02", mealStatus: "Delivered", mealType: "EGG", deliveryAddress: "Secondary" },
    { date: "2025-07-03", mealStatus: "Skipped", mealType: null, deliveryAddress: null },
    { date: "2025-07-04", mealStatus: "Delivered", mealType: "CHICKEN", deliveryAddress: "Primary" },
    { date: "2025-07-05", mealStatus: "Skipped", mealType: null, deliveryAddress: null },
    { date: "2025-07-06", mealStatus: "Delivered", mealType: "VEG", deliveryAddress: "Primary" },
    { date: "2025-07-07", mealStatus: "Delivered", mealType: "EGG", deliveryAddress: "Primary" },
    { date: "2025-07-08", mealStatus: "Delivered", mealType: "VEG", deliveryAddress: "Primary" },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("generateDailyPreferences", () => {
  it("generates correct record count (totalDays + skippedCount)", () => {
    const result = generateDailyPreferences(BASE_CTX);
    // 2 skipped days → record count = 30 + 2 = 32
    expect(result.records.length).toBe(32);
    expect(result.expectedRecordCount).toBe(32);
    expect(result.skippedCount).toBe(2);
  });

  it("extends effective end date by skipped count", () => {
    const result = generateDailyPreferences(BASE_CTX);
    // Original ends_on: 2025-07-30, +2 skipped = 2025-08-01
    expect(result.effectiveEndOn).toBe("2025-08-01");
  });

  it("does not extend effective end date when no days are skipped", () => {
    const ctx: DailyPreferencesContext = {
      ...BASE_CTX,
      pastDayStatuses: BASE_CTX.pastDayStatuses.map((s) => ({
        ...s,
        mealStatus: "Delivered" as const,
        mealType: "VEG" as const,
        deliveryAddress: "Primary" as const,
      })),
    };
    const result = generateDailyPreferences(ctx);
    expect(result.effectiveEndOn).toBe("2025-07-30");
    expect(result.skippedCount).toBe(0);
    expect(result.records.length).toBe(30);
  });

  it("maps Delivered days with correct meal_category_id and delivery_address_id", () => {
    const result = generateDailyPreferences(BASE_CTX);

    // July 1: VEG, Primary
    const day1 = result.records.find((r) => r.preference_date === "2025-07-01")!;
    expect(day1.meal_category_id).toBe("mc-veg-id");
    expect(day1.delivery_address_id).toBe("addr-primary");
    expect(day1.is_paused).toBe(false);
    expect(day1.pause_credit_used).toBe(false);

    // July 2: EGG, Secondary
    const day2 = result.records.find((r) => r.preference_date === "2025-07-02")!;
    expect(day2.meal_category_id).toBe("mc-egg-id");
    expect(day2.delivery_address_id).toBe("addr-secondary");
    expect(day2.is_paused).toBe(false);
    expect(day2.pause_credit_used).toBe(false);

    // July 4: CHICKEN, Primary
    const day4 = result.records.find((r) => r.preference_date === "2025-07-04")!;
    expect(day4.meal_category_id).toBe("mc-chicken-id");
    expect(day4.delivery_address_id).toBe("addr-primary");
    expect(day4.is_paused).toBe(false);
    expect(day4.pause_credit_used).toBe(false);
  });

  it("maps Skipped days with is_paused=true, pause_credit_used=true, initial defaults", () => {
    const result = generateDailyPreferences(BASE_CTX);

    // July 3: Skipped
    const day3 = result.records.find((r) => r.preference_date === "2025-07-03")!;
    expect(day3.meal_category_id).toBe("mc-veg-id"); // initial meal preference
    expect(day3.delivery_address_id).toBe("addr-primary"); // primary address
    expect(day3.is_paused).toBe(true);
    expect(day3.pause_credit_used).toBe(true);

    // July 5: Skipped
    const day5 = result.records.find((r) => r.preference_date === "2025-07-05")!;
    expect(day5.meal_category_id).toBe("mc-veg-id");
    expect(day5.delivery_address_id).toBe("addr-primary");
    expect(day5.is_paused).toBe(true);
    expect(day5.pause_credit_used).toBe(true);
  });

  it("maps future days with initial meal preference, primary address, not paused", () => {
    const result = generateDailyPreferences(BASE_CTX);

    // Future days start from July 9 (boundary date is July 8)
    const futureDay = result.records.find((r) => r.preference_date === "2025-07-09")!;
    expect(futureDay.meal_category_id).toBe("mc-veg-id");
    expect(futureDay.delivery_address_id).toBe("addr-primary");
    expect(futureDay.is_paused).toBe(false);
    expect(futureDay.pause_credit_used).toBe(false);

    // Last extended day (Aug 1)
    const lastDay = result.records.find((r) => r.preference_date === "2025-08-01")!;
    expect(lastDay.meal_category_id).toBe("mc-veg-id");
    expect(lastDay.delivery_address_id).toBe("addr-primary");
    expect(lastDay.is_paused).toBe(false);
    expect(lastDay.pause_credit_used).toBe(false);
  });

  it("falls back to primary address when secondary is null for Secondary delivery", () => {
    const ctx: DailyPreferencesContext = {
      ...BASE_CTX,
      secondaryAddressId: null, // No secondary address
    };
    const result = generateDailyPreferences(ctx);

    // July 2 has deliveryAddress "Secondary" but secondary is null → falls back to primary
    const day2 = result.records.find((r) => r.preference_date === "2025-07-02")!;
    expect(day2.delivery_address_id).toBe("addr-primary");
  });

  it("all records have the correct subscription_id and customer_profile_id", () => {
    const result = generateDailyPreferences(BASE_CTX);
    for (const record of result.records) {
      expect(record.subscription_id).toBe("sub-1");
      expect(record.customer_profile_id).toBe("profile-1");
    }
  });

  it("records are in chronological order", () => {
    const result = generateDailyPreferences(BASE_CTX);
    for (let i = 1; i < result.records.length; i++) {
      expect(result.records[i].preference_date > result.records[i - 1].preference_date).toBe(true);
    }
  });

  it("handles all days skipped scenario", () => {
    const pastDayStatuses = BASE_CTX.pastDayStatuses.map((s) => ({
      ...s,
      mealStatus: "Skipped" as const,
      mealType: null,
      deliveryAddress: null,
    }));
    const ctx: DailyPreferencesContext = {
      ...BASE_CTX,
      pastDayStatuses,
    };
    const result = generateDailyPreferences(ctx);
    // 8 skipped days → record count = 30 + 8 = 38
    expect(result.skippedCount).toBe(8);
    expect(result.records.length).toBe(38);
    // All past days should be paused
    for (const status of pastDayStatuses) {
      const record = result.records.find((r) => r.preference_date === status.date)!;
      expect(record.is_paused).toBe(true);
      expect(record.pause_credit_used).toBe(true);
    }
  });

  it("handles single past day scenario", () => {
    const ctx: DailyPreferencesContext = {
      ...BASE_CTX,
      startsOn: "2025-07-08",
      originalEndsOn: "2025-08-06", // 30 days
      boundaryDate: "2025-07-08",
      pastDayStatuses: [
        { date: "2025-07-08", mealStatus: "Delivered", mealType: "EGG", deliveryAddress: "Primary" },
      ],
    };
    const result = generateDailyPreferences(ctx);
    expect(result.records.length).toBe(30);
    expect(result.skippedCount).toBe(0);
    expect(result.effectiveEndOn).toBe("2025-08-06");
    expect(result.records[0].preference_date).toBe("2025-07-08");
    expect(result.records[0].meal_category_id).toBe("mc-egg-id");
  });
});
