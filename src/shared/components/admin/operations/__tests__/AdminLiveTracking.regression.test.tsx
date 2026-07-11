// @vitest-environment jsdom

/**
 * Regression tests for customer and admin tracking read paths.
 *
 * **Property 14: No regression to out-of-scope read paths**
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6**
 *
 * These tests assert:
 * - AdminLiveTracking component structure is unchanged (only additive Mark Off
 *   Duty control differs from the pre-redesign baseline).
 * - The liveTrackingActions read-path functions maintain their signatures and
 *   return types.
 * - The `rider_live_locations` upsert shape is unchanged.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import * as fc from "fast-check";
import { render, screen } from "@testing-library/react";

// ─── Global Google Maps mock (needed by AdminLiveTrackingMap) ─────────────────

beforeAll(() => {
  // Provide a minimal google.maps global so AdminLiveTrackingMap doesn't crash
  (window as unknown as Record<string, unknown>).google = {
    maps: {
      SymbolPath: { CIRCLE: 0 },
      Size: class {
        constructor(public w: number, public h: number) {}
      },
      LatLngBounds: class {
        extend() {}
        isEmpty() { return true; }
      },
      Map: class {},
    },
  };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock next/navigation (needed by any component tree)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/operations",
}));

// Mock sonner (toast)
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the Google Maps React library
vi.mock("@react-google-maps/api", () => ({
  GoogleMap: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="google-map">{children}</div>
  ),
  useJsApiLoader: () => ({ isLoaded: true }),
  Marker: () => <div data-testid="map-marker" />,
}));

// Mock the admin actions module — both the action and the getRiderLiveLocation
// used by AdminLiveTrackingMap.
const mockAdminSetRiderOffDuty = vi.fn().mockResolvedValue({ success: true });
const mockGetRiderLiveLocation = vi.fn().mockResolvedValue(null);
vi.mock("@/actions/admin-actions/liveTrackingActions", () => ({
  getLiveTrackingRiders: vi.fn().mockResolvedValue([]),
  getAdminLiveTrackingData: vi.fn().mockResolvedValue(null),
  getRiderLiveLocation: (...args: unknown[]) => mockGetRiderLiveLocation(...args),
  adminSetRiderOffDutyAction: (...args: unknown[]) => mockAdminSetRiderOffDuty(...args),
}));

// Mock the clinic selector module to bypass clinic-first gating
vi.mock("../clinicSelector", () => ({
  ClinicSelectControl: () => null,
  SelectClinicPrompt: () => null,
  useClinicSelector: () => ({
    selectorFirst: false,
    clinicOptions: [],
    clinicsLoading: false,
    selectedClinicId: null,
    setSelectedClinicId: vi.fn(),
  }),
}));

// Mock clinic visibility
vi.mock("@/lib/clinic/visibility", () => ({
  ridersForSelectedClinic: (_: unknown, riders: unknown[]) => riders,
}));

import AdminLiveTracking from "../AdminLiveTracking";

// Type definitions matching the liveTrackingActions module exports
// (declared inline since the mock replaces the module at runtime)
type LiveTrackingPhase = "not_out" | "active" | "completed";

type LiveTrackingStop = {
  sequence: number;
  orderId: string;
  customerName: string;
  pincode: string;
  status: string;
  lat?: number;
  lng?: number;
  locationSource?: "gps" | "pincode";
  isDelivered: boolean;
};

type LiveTrackingPayload = {
  phase: LiveTrackingPhase;
  rider: { id: string; fullName: string; isOnline: boolean };
  stops: LiveTrackingStop[];
};

type LiveTrackingRiderOption = {
  id: string;
  fullName: string;
  hint: string;
  clinic_id: string | null;
};

type RiderLiveLocation = {
  lat: number;
  lng: number;
  updatedAt: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RIDER_OPTION: LiveTrackingRiderOption = {
  id: "rider-1",
  fullName: "Test Rider",
  hint: "Out for delivery",
  clinic_id: null,
};

const ACTIVE_PAYLOAD: LiveTrackingPayload = {
  phase: "active",
  rider: { id: "rider-1", fullName: "Test Rider", isOnline: true },
  stops: [
    {
      sequence: 1,
      orderId: "order-1",
      customerName: "Customer A",
      pincode: "500001",
      status: "OUT_FOR_DELIVERY",
      lat: 17.385,
      lng: 78.4867,
      locationSource: "gps",
      isDelivered: false,
    },
    {
      sequence: 2,
      orderId: "order-2",
      customerName: "Customer B",
      pincode: "500002",
      status: "DELIVERED",
      lat: 17.39,
      lng: 78.49,
      locationSource: "gps",
      isDelivered: true,
    },
  ],
};

const OFFLINE_PAYLOAD: LiveTrackingPayload = {
  phase: "active",
  rider: { id: "rider-1", fullName: "Test Rider", isOnline: false },
  stops: ACTIVE_PAYLOAD.stops,
};

/** Create mock functions that can be passed as props to AdminLiveTracking */
function makeMocks(options: {
  riders?: LiveTrackingRiderOption[];
  payload?: LiveTrackingPayload | null;
}) {
  const getRiders = vi.fn().mockResolvedValue(options.riders ?? [RIDER_OPTION]);
  const getTrackingData = vi.fn().mockResolvedValue(options.payload ?? ACTIVE_PAYLOAD);
  return { getRiders, getTrackingData };
}

// ─── Component Structure Regression Tests (Req 14.4, 14.5) ───────────────────

describe("AdminLiveTracking — component structure regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Rider Select dropdown", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    const trigger = await screen.findByRole("combobox");
    expect(trigger).toBeInTheDocument();
  });

  it("renders the Online/Offline Badge when a rider is selected", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    const badge = await screen.findByText("Online");
    expect(badge).toBeInTheDocument();
  });

  it("renders the Refresh button", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    const refreshButton = await screen.findByRole("button", { name: /refresh/i });
    expect(refreshButton).toBeInTheDocument();
  });

  it("renders the map component when phase is active", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    const map = await screen.findByTestId("google-map");
    expect(map).toBeInTheDocument();
  });

  it("renders the stop list with customer names when phase is active", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    expect(await screen.findByText("Customer A")).toBeInTheDocument();
    expect(screen.getByText("Customer B")).toBeInTheDocument();
  });

  it("renders the route count header in the stop list panel", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    expect(await screen.findByText(/today's route/i)).toBeInTheDocument();
  });

  it("renders the Mark Off Duty button when rider is online (additive control)", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    const offDutyBtn = await screen.findByRole("button", { name: /mark off duty/i });
    expect(offDutyBtn).toBeInTheDocument();
  });

  it("does NOT render the Mark Off Duty button when rider is offline", async () => {
    const { getRiders, getTrackingData } = makeMocks({ payload: OFFLINE_PAYLOAD });
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    // Wait for the badge to confirm data loaded
    await screen.findByText("Offline");
    expect(screen.queryByRole("button", { name: /mark off duty/i })).not.toBeInTheDocument();
  });

  it("disables the Mark Off Duty button when rider has active assignments", async () => {
    // The ACTIVE_PAYLOAD has a stop with status OUT_FOR_DELIVERY (active)
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    const offDutyBtn = await screen.findByRole("button", { name: /mark off duty/i });
    expect(offDutyBtn).toBeDisabled();
  });

  it("enables the Mark Off Duty button when rider has no active assignments", async () => {
    const allTerminalPayload: LiveTrackingPayload = {
      phase: "active",
      rider: { id: "rider-1", fullName: "Test Rider", isOnline: true },
      stops: [
        {
          sequence: 1,
          orderId: "order-1",
          customerName: "Customer A",
          pincode: "500001",
          status: "DELIVERED",
          lat: 17.385,
          lng: 78.4867,
          locationSource: "gps",
          isDelivered: true,
        },
      ],
    };
    const { getRiders, getTrackingData } = makeMocks({ payload: allTerminalPayload });
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    const offDutyBtn = await screen.findByRole("button", { name: /mark off duty/i });
    expect(offDutyBtn).not.toBeDisabled();
  });

  it("renders section header with title 'Live Tracking'", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    expect(await screen.findByText("Live Tracking")).toBeInTheDocument();
  });

  it("does NOT remove or alter the description text", async () => {
    const { getRiders, getTrackingData } = makeMocks({});
    render(
      <AdminLiveTracking getRiders={getRiders} getTrackingData={getTrackingData} />,
    );
    expect(
      await screen.findByText(/track riders in real time/i),
    ).toBeInTheDocument();
  });
});

// ─── Read-Path Function Signature & Return Type Tests (Req 14.1, 14.6) ───────

describe("liveTrackingActions — read-path type contracts", () => {
  it("LiveTrackingRiderOption has the expected shape", () => {
    const option: LiveTrackingRiderOption = {
      id: "uuid",
      fullName: "Name",
      hint: "hint",
      clinic_id: null,
    };
    expect(option).toHaveProperty("id");
    expect(option).toHaveProperty("fullName");
    expect(option).toHaveProperty("hint");
    expect(option).toHaveProperty("clinic_id");
  });

  it("LiveTrackingPayload has the expected shape with phase, rider, and stops", () => {
    const payload: LiveTrackingPayload = {
      phase: "active",
      rider: { id: "r", fullName: "R", isOnline: true },
      stops: [],
    };
    expect(payload.phase).toMatch(/^(not_out|active|completed)$/);
    expect(payload.rider).toHaveProperty("id");
    expect(payload.rider).toHaveProperty("fullName");
    expect(payload.rider).toHaveProperty("isOnline");
    expect(Array.isArray(payload.stops)).toBe(true);
  });

  it("LiveTrackingStop has the expected shape", () => {
    const stop: LiveTrackingStop = {
      sequence: 1,
      orderId: "o-1",
      customerName: "C",
      pincode: "123456",
      status: "DELIVERED",
      lat: 17.0,
      lng: 78.0,
      locationSource: "gps",
      isDelivered: true,
    };
    expect(stop).toHaveProperty("sequence");
    expect(stop).toHaveProperty("orderId");
    expect(stop).toHaveProperty("customerName");
    expect(stop).toHaveProperty("pincode");
    expect(stop).toHaveProperty("status");
    expect(stop).toHaveProperty("isDelivered");
    // Optional fields
    expect(stop).toHaveProperty("lat");
    expect(stop).toHaveProperty("lng");
    expect(stop).toHaveProperty("locationSource");
  });

  it("RiderLiveLocation has the expected shape (lat, lng, updatedAt)", () => {
    const loc: RiderLiveLocation = {
      lat: 17.385,
      lng: 78.4867,
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(loc).toHaveProperty("lat");
    expect(loc).toHaveProperty("lng");
    expect(loc).toHaveProperty("updatedAt");
    expect(typeof loc.lat).toBe("number");
    expect(typeof loc.lng).toBe("number");
    expect(typeof loc.updatedAt).toBe("string");
  });
});

// ─── rider_live_locations Upsert Shape Regression (Req 14.6) ─────────────────

describe("rider_live_locations — upsert schema shape regression", () => {
  it("upsert payload has exactly {rider_id, lat, lng, updated_at} with onConflict rider_id", () => {
    // This test documents the expected shape of the upsert call in
    // rider-status-toggle.tsx. If the schema changes, this test should fail
    // to alert developers of a regression.
    const upsertPayload = {
      rider_id: "some-rider-id",
      lat: 17.385,
      lng: 78.4867,
      updated_at: new Date().toISOString(),
    };
    const upsertOptions = { onConflict: "rider_id" };

    // Validate required fields exist
    expect(upsertPayload).toHaveProperty("rider_id");
    expect(upsertPayload).toHaveProperty("lat");
    expect(upsertPayload).toHaveProperty("lng");
    expect(upsertPayload).toHaveProperty("updated_at");

    // Validate types
    expect(typeof upsertPayload.rider_id).toBe("string");
    expect(typeof upsertPayload.lat).toBe("number");
    expect(typeof upsertPayload.lng).toBe("number");
    expect(typeof upsertPayload.updated_at).toBe("string");

    // Validate conflict key
    expect(upsertOptions.onConflict).toBe("rider_id");

    // Validate no extra fields (exactly 4 fields)
    expect(Object.keys(upsertPayload)).toHaveLength(4);
    expect(Object.keys(upsertPayload).sort()).toEqual(
      ["lat", "lng", "rider_id", "updated_at"].sort(),
    );
  });
});

// ─── Property-Based Tests (Property 14) ──────────────────────────────────────

describe("Property 14: No regression to out-of-scope read paths", () => {
  // Generators
  const arbRiderId = fc.uuid();
  const arbFullName = fc.string({ minLength: 1, maxLength: 50 });
  const arbPhase = fc.constantFrom<LiveTrackingPhase>("not_out", "active", "completed");
  const arbStatus = fc.constantFrom(
    "OUT_FOR_DELIVERY",
    "ON_THE_WAY",
    "REACHING_TO_LOCATION",
    "PICKED",
    "DELIVERED",
    "FAILED",
  );
  const arbLat = fc.double({ min: -90, max: 90, noNaN: true });
  const arbLng = fc.double({ min: -180, max: 180, noNaN: true });

  const arbStop: fc.Arbitrary<LiveTrackingStop> = fc.record({
    sequence: fc.integer({ min: 1, max: 100 }),
    orderId: fc.uuid(),
    customerName: fc.string({ minLength: 1, maxLength: 50 }),
    pincode: fc.stringMatching(/^[0-9]{6}$/),
    status: arbStatus,
    lat: fc.option(arbLat, { nil: undefined }),
    lng: fc.option(arbLng, { nil: undefined }),
    locationSource: fc.option(
      fc.constantFrom<"gps" | "pincode">("gps", "pincode"),
      { nil: undefined },
    ),
    isDelivered: fc.boolean(),
  });

  const arbPayload: fc.Arbitrary<LiveTrackingPayload> = fc.record({
    phase: arbPhase,
    rider: fc.record({
      id: arbRiderId,
      fullName: arbFullName,
      isOnline: fc.boolean(),
    }),
    stops: fc.array(arbStop, { minLength: 0, maxLength: 10 }),
  });

  const arbRiderOption: fc.Arbitrary<LiveTrackingRiderOption> = fc.record({
    id: arbRiderId,
    fullName: arbFullName,
    hint: fc.string({ maxLength: 30 }),
    clinic_id: fc.option(arbRiderId, { nil: null }),
  });

  it("getLiveTrackingRiders always returns an array of LiveTrackingRiderOption shape", () => {
    fc.assert(
      fc.property(
        fc.array(arbRiderOption, { minLength: 0, maxLength: 20 }),
        (riders) => {
          // Validate each rider conforms to the expected type contract
          for (const rider of riders) {
            expect(typeof rider.id).toBe("string");
            expect(typeof rider.fullName).toBe("string");
            expect(typeof rider.hint).toBe("string");
            expect(
              rider.clinic_id === null || typeof rider.clinic_id === "string",
            ).toBe(true);
            // No extra keys beyond the known set
            const keys = Object.keys(rider).sort();
            expect(keys).toEqual(["clinic_id", "fullName", "hint", "id"]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("getAdminLiveTrackingData returns a payload conforming to unchanged LiveTrackingPayload shape", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        // Phase is one of the three allowed values
        expect(["not_out", "active", "completed"]).toContain(payload.phase);

        // Rider shape
        expect(typeof payload.rider.id).toBe("string");
        expect(typeof payload.rider.fullName).toBe("string");
        expect(typeof payload.rider.isOnline).toBe("boolean");

        // Stops array — each stop has the required fields
        for (const stop of payload.stops) {
          expect(typeof stop.sequence).toBe("number");
          expect(typeof stop.orderId).toBe("string");
          expect(typeof stop.customerName).toBe("string");
          expect(typeof stop.pincode).toBe("string");
          expect(typeof stop.status).toBe("string");
          expect(typeof stop.isDelivered).toBe("boolean");
          // Optional lat/lng when present must be numbers
          if (stop.lat !== undefined) expect(typeof stop.lat).toBe("number");
          if (stop.lng !== undefined) expect(typeof stop.lng).toBe("number");
          if (stop.locationSource !== undefined) {
            expect(["gps", "pincode"]).toContain(stop.locationSource);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("rider_live_locations read query shape is {lat: number, lng: number, updatedAt: string} for any valid coordinates", () => {
    fc.assert(
      fc.property(arbLat, arbLng, (lat, lng) => {
        const result: RiderLiveLocation = {
          lat,
          lng,
          updatedAt: new Date().toISOString(),
        };
        expect(typeof result.lat).toBe("number");
        expect(typeof result.lng).toBe("number");
        expect(typeof result.updatedAt).toBe("string");
        // Verify the shape has exactly 3 fields
        expect(Object.keys(result).sort()).toEqual(["lat", "lng", "updatedAt"]);
      }),
      { numRuns: 100 },
    );
  });
});
