// Feature: core-clinic-architecture, Property 5: Clinic persistence round-trip
//
// Property test for clinic create/update persistence round-trip via the
// master-portal Server Actions `createClinic` / `updateClinic`
// (src/actions/master-actions/clinicActions.ts).
//
// Property 5: Clinic persistence round-trip
//   For any valid clinic input, creating then reading back yields equal
//   name/address/latitude/longitude/kitchen_id; editing to new valid values
//   then reading back yields the updated values.
//
// Because a live Supabase connection is not available in unit tests, the
// round-trip is modeled against an IN-MEMORY fake of the clinic repository (a
// Map<string, Clinic>): the `@/repositories/clinic/clinicRepository` module is
// mocked so insertClinic/getClinicById/updateClinic operate on the store, the
// kitchen repository is mocked so referenced kitchens always exist (with a null
// city so the re-association same-city rule never rejects a valid edit), auth is
// mocked as an ADMIN caller, and `next/cache` is stubbed.
//
// Validates: Requirements 3.1, 14.4

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { Clinic, ClinicCreateInput, ClinicUpdateInput } from "@/types/clinic";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Stub Next.js cache revalidation (no-op outside a request scope).
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

// Mock auth: the caller is always a valid ADMIN, mirroring the user/roles
// lookup chain in `assertCallerCanManageClinics`.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-admin" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "admin-user", roles: { code: "ADMIN" } },
          }),
        }),
      }),
    }),
  }),
}));

// Mock the kitchen repository: every referenced kitchen exists. `city_id` is
// null so `updateClinic`'s same-city re-association guard is a no-op for a
// kitchen change (the guard only fires when the current kitchen has a city).
vi.mock("@/repositories/clinic/kitchenRepository", () => ({
  getKitchenById: async (id: string) => ({
    id,
    name: "Test Kitchen",
    address_text: null,
    lat: null,
    lng: null,
    is_active: true,
    city_id: null,
  }),
}));

// Mock the clinic repository with an in-memory Map<string, Clinic>.
vi.mock("@/repositories/clinic/clinicRepository", () => {
  const store = new Map<string, Clinic>();
  let counter = 0;

  return {
    __store: store,
    insertClinic: async (input: ClinicCreateInput): Promise<Clinic> => {
      const id = `clinic-${++counter}`;
      const now = new Date().toISOString();
      const clinic: Clinic = {
        id,
        name: input.name,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        kitchen_id: input.kitchen_id,
        franchise_id: input.franchise_id ?? null,
        created_at: now,
        updated_at: now,
      };
      store.set(id, clinic);
      return clinic;
    },
    getClinicById: async (id: string): Promise<Clinic | null> =>
      store.get(id) ?? null,
    updateClinic: async (
      id: string,
      input: ClinicUpdateInput
    ): Promise<Clinic> => {
      const existing = store.get(id);
      if (!existing) {
        throw new Error(`Failed to update clinic ${id}: not found`);
      }
      const updated: Clinic = { ...existing };
      if (input.name !== undefined) updated.name = input.name;
      if (input.address !== undefined) updated.address = input.address;
      if (input.latitude !== undefined) updated.latitude = input.latitude;
      if (input.longitude !== undefined) updated.longitude = input.longitude;
      if (input.kitchen_id !== undefined) updated.kitchen_id = input.kitchen_id;
      if (input.franchise_id !== undefined)
        updated.franchise_id = input.franchise_id;
      updated.updated_at = new Date().toISOString();
      store.set(id, updated);
      return updated;
    },
    deleteClinic: async (id: string): Promise<void> => {
      store.delete(id);
    },
    countClinicDependents: async () => ({
      serviceAreas: 0,
      riders: 0,
      customers: 0,
      snapshots: 0,
      total: 0,
    }),
  };
});

// Import AFTER the mocks are registered so the action binds to the fakes.
import { createClinic, updateClinic } from "../clinicActions";
import * as clinicRepo from "@/repositories/clinic/clinicRepository";

const store = (clinicRepo as unknown as { __store: Map<string, Clinic> })
  .__store;

// ─── Generators ────────────────────────────────────────────────────────────
//
// Valid clinic inputs constrained to the canonical create bounds. Text fields
// are pre-trimmed (and required non-empty after trim) so the action's `.trim()`
// is idempotent and the round-trip comparison is exact.

const trimmedText = (minLen: number, maxLen: number): fc.Arbitrary<string> =>
  fc
    .string({ minLength: minLen, maxLength: maxLen })
    .map((s) => s.trim())
    .filter((s) => s.length >= 1 && s.length <= maxLen);

const arbName = trimmedText(1, 120); // create bound: name 1..120
const arbAddress = trimmedText(1, 255); // create bound: address 1..255
const arbLatitude = fc.double({ min: -90, max: 90, noNaN: true });
const arbLongitude = fc.double({ min: -180, max: 180, noNaN: true });
const arbKitchenId = fc.uuid();

const arbClinicInput: fc.Arbitrary<ClinicCreateInput> = fc.record({
  name: arbName,
  address: arbAddress,
  latitude: arbLatitude,
  longitude: arbLongitude,
  kitchen_id: arbKitchenId,
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Clinic persistence round-trip - Property 5", () => {
  beforeEach(() => {
    store.clear();
  });

  it("create then read-back yields equal field values; edit then read-back yields the updated values", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClinicInput,
        arbClinicInput,
        async (createInput, editInput) => {
          store.clear();

          // ── Create round-trip ──────────────────────────────────────────
          const created = await createClinic(createInput);
          expect(created.success).toBe(true);
          if (!created.success) return;

          const afterCreate = await (
            clinicRepo as unknown as {
              getClinicById: (id: string) => Promise<Clinic | null>;
            }
          ).getClinicById(created.data.id);

          expect(afterCreate).not.toBeNull();
          expect(afterCreate!.name).toBe(createInput.name);
          expect(afterCreate!.address).toBe(createInput.address);
          expect(afterCreate!.latitude).toBe(createInput.latitude);
          expect(afterCreate!.longitude).toBe(createInput.longitude);
          expect(afterCreate!.kitchen_id).toBe(createInput.kitchen_id);

          // ── Edit round-trip ────────────────────────────────────────────
          const updated = await updateClinic(created.data.id, {
            name: editInput.name,
            address: editInput.address,
            latitude: editInput.latitude,
            longitude: editInput.longitude,
            kitchen_id: editInput.kitchen_id,
          });
          expect(updated.success).toBe(true);
          if (!updated.success) return;

          const afterEdit = await (
            clinicRepo as unknown as {
              getClinicById: (id: string) => Promise<Clinic | null>;
            }
          ).getClinicById(created.data.id);

          expect(afterEdit).not.toBeNull();
          expect(afterEdit!.name).toBe(editInput.name);
          expect(afterEdit!.address).toBe(editInput.address);
          expect(afterEdit!.latitude).toBe(editInput.latitude);
          expect(afterEdit!.longitude).toBe(editInput.longitude);
          expect(afterEdit!.kitchen_id).toBe(editInput.kitchen_id);

          // The identifier is stable across the edit.
          expect(afterEdit!.id).toBe(created.data.id);
        }
      ),
      { numRuns: 200 }
    );
  });
});
