import { describe, it, expect } from "vitest";
import {
  pastDayStatusBoundary,
  isPastStartDateValid,
  getPastDateRange,
  PAST_DATE_MAX_DAYS,
} from "../cutoff";

// 11:29 UTC = 16:59 IST (before 17:00 cutoff); 11:31 UTC = 17:01 IST (after)
const before = new Date("2024-06-10T11:29:00Z"); // IST: 2024-06-10 16:59
const after = new Date("2024-06-10T11:31:00Z"); // IST: 2024-06-10 17:01
const at = new Date("2024-06-10T11:30:00Z"); // IST: 2024-06-10 17:00

describe("pastDayStatusBoundary", () => {
  it("before 17:00 IST → yesterday", () => {
    expect(pastDayStatusBoundary(before)).toBe("2024-06-09");
  });
  it("at 17:00 IST → today", () => {
    expect(pastDayStatusBoundary(at)).toBe("2024-06-10");
  });
  it("after 17:00 IST → today", () => {
    expect(pastDayStatusBoundary(after)).toBe("2024-06-10");
  });
});

describe("isPastStartDateValid", () => {
  // IST today for all test instants is 2024-06-10
  it("accepts yesterday", () => {
    expect(isPastStartDateValid("2024-06-09", before)).toBe(true);
  });
  it("accepts exactly 30 days ago", () => {
    // 2024-06-10 minus 30 days = 2024-05-11
    expect(isPastStartDateValid("2024-05-11", before)).toBe(true);
  });
  it("rejects today (not strictly before)", () => {
    expect(isPastStartDateValid("2024-06-10", before)).toBe(false);
  });
  it("rejects future dates", () => {
    expect(isPastStartDateValid("2024-06-11", before)).toBe(false);
  });
  it("rejects 31 days ago", () => {
    // 2024-06-10 minus 31 days = 2024-05-10
    expect(isPastStartDateValid("2024-05-10", before)).toBe(false);
  });
});

describe("getPastDateRange", () => {
  it("returns [today-30, today-1] for a given today", () => {
    const result = getPastDateRange("2024-06-10");
    expect(result.start).toBe("2024-05-11");
    expect(result.end).toBe("2024-06-09");
  });
  it("range spans exactly 30 days", () => {
    const result = getPastDateRange("2024-06-10");
    // From 2024-05-11 to 2024-06-09 inclusive = 30 days
    const start = new Date(result.start);
    const end = new Date(result.end);
    const diffDays =
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1;
    expect(diffDays).toBe(PAST_DATE_MAX_DAYS);
  });
});
