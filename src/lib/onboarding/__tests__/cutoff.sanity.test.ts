import { describe, it, expect } from "vitest";
import { earliestStartDate, isStartDateAllowed } from "../cutoff";

// 11:29 UTC = 16:59 IST (before 17:00 cutoff); 11:31 UTC = 17:01 IST (after)
const before = new Date("2024-06-10T11:29:00Z");
const after = new Date("2024-06-10T11:31:00Z");
const at = new Date("2024-06-10T11:30:00Z"); // exactly 17:00 IST

describe("cutoff sanity", () => {
  it("before cutoff → today+1", () => {
    expect(earliestStartDate(before)).toBe("2024-06-11");
  });
  it("at cutoff → today+2 (at/after)", () => {
    expect(earliestStartDate(at)).toBe("2024-06-12");
  });
  it("after cutoff → today+2", () => {
    expect(earliestStartDate(after)).toBe("2024-06-12");
  });
  it("allows dates on/after earliest, rejects earlier", () => {
    expect(isStartDateAllowed("2024-06-11", before)).toBe(true);
    expect(isStartDateAllowed("2024-06-10", before)).toBe(false);
    expect(isStartDateAllowed("2024-06-11", after)).toBe(false);
    expect(isStartDateAllowed("2024-06-12", after)).toBe(true);
  });
});
