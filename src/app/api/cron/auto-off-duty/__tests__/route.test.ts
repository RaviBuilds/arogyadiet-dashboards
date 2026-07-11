// src/app/api/cron/auto-off-duty/__tests__/route.test.ts
//
// Unit tests for the auto-off-duty cron route.
// Validates: Requirements 10.3, 10.8, 10.10
//
// Test cases:
//  1. Wrong/missing secret → 401 with no sweep invoked (no writes).
//  2. Correct secret → 200, sweep called with admin client, results returned.
//  3. Idempotency: double-run produces no double effect (sweep evaluates state).
//  4. Propagation failure: flipped rider retained, error recorded in response.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────────

// Mock createAdminClient
const mockAdminClient = { __mock: true };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}));

// Mock runAutoOffDutySweep
const mockRunAutoOffDutySweep = vi.fn();
vi.mock("@/lib/delivery/auto-off-duty-sweep", () => ({
  runAutoOffDutySweep: (...args: unknown[]) => mockRunAutoOffDutySweep(...args),
}));

// Mock propagateOffDuty
const mockPropagateOffDuty = vi.fn();
vi.mock("@/lib/delivery/duty-lifecycle", () => ({
  propagateOffDuty: (...args: unknown[]) => mockPropagateOffDuty(...args),
}));

// Set the CRON_SECRET env var for tests
const TEST_SECRET = "test-cron-secret-abc123";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = TEST_SECRET;
});

// Import the route handler after mocks are set up
import { GET } from "../route";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(secret?: string | null): Request {
  const url = secret != null
    ? `http://localhost:3000/api/cron/auto-off-duty?secret=${secret}`
    : `http://localhost:3000/api/cron/auto-off-duty`;
  return new Request(url, { method: "GET" });
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/cron/auto-off-duty", () => {
  describe("Requirement 10.3 — Wrong secret → 401 with no writes", () => {
    it("returns 401 when secret is missing from the query", async () => {
      const response = await GET(makeRequest());

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");

      // No sweep or propagation should have been called
      expect(mockRunAutoOffDutySweep).not.toHaveBeenCalled();
      expect(mockPropagateOffDuty).not.toHaveBeenCalled();
    });

    it("returns 401 when secret is wrong", async () => {
      const response = await GET(makeRequest("wrong-secret"));

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");

      expect(mockRunAutoOffDutySweep).not.toHaveBeenCalled();
      expect(mockPropagateOffDuty).not.toHaveBeenCalled();
    });

    it("returns 401 when CRON_SECRET env is unset", async () => {
      delete process.env.CRON_SECRET;

      const response = await GET(makeRequest(TEST_SECRET));

      expect(response.status).toBe(401);
      expect(mockRunAutoOffDutySweep).not.toHaveBeenCalled();
      expect(mockPropagateOffDuty).not.toHaveBeenCalled();
    });
  });

  describe("Correct secret → 200, sweep runs", () => {
    it("calls runAutoOffDutySweep with the admin client and returns results", async () => {
      mockRunAutoOffDutySweep.mockResolvedValue({
        flipped: ["rider-1", "rider-2"],
        skipped: ["rider-3"],
        errors: [],
      });
      mockPropagateOffDuty.mockResolvedValue(undefined);

      const response = await GET(makeRequest(TEST_SECRET));

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.success).toBe(true);
      expect(body.data.flippedCount).toBe(2);
      expect(body.data.flipped).toEqual(["rider-1", "rider-2"]);
      expect(body.data.skippedCount).toBe(1);
      expect(body.data.errors).toEqual([]);
      expect(body.data.propagationErrors).toEqual([]);

      // Sweep called with the admin client
      expect(mockRunAutoOffDutySweep).toHaveBeenCalledTimes(1);
      expect(mockRunAutoOffDutySweep).toHaveBeenCalledWith(mockAdminClient);

      // Propagation called per flipped rider
      expect(mockPropagateOffDuty).toHaveBeenCalledTimes(2);
      expect(mockPropagateOffDuty).toHaveBeenCalledWith("rider-1");
      expect(mockPropagateOffDuty).toHaveBeenCalledWith("rider-2");
    });
  });

  describe("Requirement 10.10 — Idempotency / double-run no double effect", () => {
    it("second run with no online riders produces no flips (idempotent by design)", async () => {
      // First run: sweep flips rider-1
      mockRunAutoOffDutySweep.mockResolvedValueOnce({
        flipped: ["rider-1"],
        skipped: [],
        errors: [],
      });
      mockPropagateOffDuty.mockResolvedValue(undefined);

      const response1 = await GET(makeRequest(TEST_SECRET));
      expect(response1.status).toBe(200);
      const body1 = await response1.json();
      expect(body1.data.flippedCount).toBe(1);

      // Second run: sweep re-evaluates state and finds no one eligible
      // (rider-1 is already is_online=false so sweep skips them)
      mockRunAutoOffDutySweep.mockResolvedValueOnce({
        flipped: [],
        skipped: ["rider-1"],
        errors: [],
      });

      const response2 = await GET(makeRequest(TEST_SECRET));
      expect(response2.status).toBe(200);
      const body2 = await response2.json();

      // No double effect: second run flips nobody
      expect(body2.data.flippedCount).toBe(0);
      expect(body2.data.flipped).toEqual([]);
      expect(body2.data.skippedCount).toBe(1);
    });

    it("re-run after partial failure only processes remaining riders", async () => {
      // First run: rider-1 flipped, rider-2 had an evaluation error
      mockRunAutoOffDutySweep.mockResolvedValueOnce({
        flipped: ["rider-1"],
        skipped: [],
        errors: [{ riderId: "rider-2", error: "DB timeout" }],
      });
      mockPropagateOffDuty.mockResolvedValue(undefined);

      const response1 = await GET(makeRequest(TEST_SECRET));
      const body1 = await response1.json();
      expect(body1.data.flippedCount).toBe(1);
      expect(body1.data.errors).toHaveLength(1);

      // Second run: rider-1 already off, rider-2 now succeeds
      mockRunAutoOffDutySweep.mockResolvedValueOnce({
        flipped: ["rider-2"],
        skipped: ["rider-1"],
        errors: [],
      });

      const response2 = await GET(makeRequest(TEST_SECRET));
      const body2 = await response2.json();

      // rider-1 not flipped again (idempotent), rider-2 now flipped
      expect(body2.data.flippedCount).toBe(1);
      expect(body2.data.flipped).toEqual(["rider-2"]);
    });
  });

  describe("Requirement 10.8 — Propagation failure retains flipped state and records error", () => {
    it("retains is_online=false and records propagation error when propagateOffDuty throws", async () => {
      mockRunAutoOffDutySweep.mockResolvedValue({
        flipped: ["rider-1", "rider-2"],
        skipped: [],
        errors: [],
      });

      // rider-1 propagation succeeds, rider-2 fails
      mockPropagateOffDuty
        .mockResolvedValueOnce(undefined) // rider-1 OK
        .mockRejectedValueOnce(new Error("OneSignal push failed")); // rider-2 fails

      const response = await GET(makeRequest(TEST_SECRET));

      expect(response.status).toBe(200);
      const body = await response.json();

      // Both riders are still in the flipped list (is_online=false retained)
      expect(body.data.flipped).toEqual(["rider-1", "rider-2"]);
      expect(body.data.flippedCount).toBe(2);

      // Propagation error recorded for rider-2
      expect(body.data.propagationErrors).toHaveLength(1);
      expect(body.data.propagationErrors[0]).toEqual({
        riderId: "rider-2",
        error: "OneSignal push failed",
      });
    });

    it("records multiple propagation errors without reverting flipped state", async () => {
      mockRunAutoOffDutySweep.mockResolvedValue({
        flipped: ["rider-a", "rider-b", "rider-c"],
        skipped: [],
        errors: [],
      });

      // All propagations fail
      mockPropagateOffDuty
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("Service unavailable"))
        .mockRejectedValueOnce(new Error("Push endpoint 404"));

      const response = await GET(makeRequest(TEST_SECRET));
      expect(response.status).toBe(200);
      const body = await response.json();

      // All riders remain flipped (state not reverted)
      expect(body.data.flipped).toEqual(["rider-a", "rider-b", "rider-c"]);
      expect(body.data.flippedCount).toBe(3);

      // All propagation errors recorded
      expect(body.data.propagationErrors).toHaveLength(3);
      expect(body.data.propagationErrors[0].riderId).toBe("rider-a");
      expect(body.data.propagationErrors[1].riderId).toBe("rider-b");
      expect(body.data.propagationErrors[2].riderId).toBe("rider-c");
    });
  });
});
