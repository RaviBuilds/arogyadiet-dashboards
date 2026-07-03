// @vitest-environment jsdom

// src/shared/components/address/__tests__/AddressCaptureMap.test.tsx
//
// Component test for the map-based Address_Capture (Task 11.3).
//
//   Req 5.1 — the address-tag selector offers exactly "Home" and "Office",
//             with "Home" selected by default.
//
// Google Maps and Capacitor are mocked so the component renders in jsdom
// without a real maps SDK. The tag RadioGroup renders above the map and does
// not depend on the SDK being loaded.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// --- Mock the Google Maps SDK wrapper --------------------------------------
vi.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({ isLoaded: false, loadError: undefined }),
  GoogleMap: () => null,
  Autocomplete: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// --- Mock Capacitor (native detection + geolocation) -----------------------
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    requestPermissions: vi.fn(),
    getCurrentPosition: vi.fn(),
  },
}));

import {
  AddressCaptureMap,
  emptyAddressCaptureValue,
} from "@/shared/components/address/AddressCaptureMap";

beforeEach(() => {
  // The component returns a "Map unavailable" placeholder without an API key.
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
});

describe("AddressCaptureMap — address tag (Req 5.1)", () => {
  it("defaults the empty value's tag to Home", () => {
    expect(emptyAddressCaptureValue.tag).toBe("Home");
  });

  it("offers exactly Home and Office, with Home checked by default", () => {
    render(
      <AddressCaptureMap
        value={emptyAddressCaptureValue}
        onChange={() => {}}
        serviceAreaPincodes={[]}
      />,
    );

    const home = screen.getByRole("radio", { name: "Home" });
    const office = screen.getByRole("radio", { name: "Office" });

    // Exactly two tag options are offered (Req 5.1).
    expect(screen.getAllByRole("radio")).toHaveLength(2);

    // Home is selected by default; Office is not.
    expect(home).toBeChecked();
    expect(office).not.toBeChecked();
  });
});
