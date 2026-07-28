// @vitest-environment jsdom
//
// src/test/dietitian/user-management-partition.property.test.tsx
// Feature: dietitian-management, Property 14
//
// Property 14: Dietitians are partitioned out of the Admin Users list.
//
// For any set of users — each carrying a raw `admin_access_level` value,
// including seeded Dietitians, every other Access_Level, and malformed /
// unrecognised legacy values that must coerce to the backward-compatible
// default — the Master Portal's User Management page places every user into
// exactly one of the Admin Users table or the Dietitians table, and that
// placement always matches the user's resolved Access_Level. No user is
// duplicated across both tables and no user is missing from both
// (exhaustive, mutually exclusive partition).
//
// **Validates: Requirements 3.1, 3.2**

import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import * as fc from "fast-check";

import { rawAccessLevelArb } from "@/test/dietitian/arbitraries";
import { resolveAccessLevel, DIETITIAN_ACCESS_LEVEL } from "@/lib/auth/adminAccessCore";
import type { DietitianAccount } from "@/types/dietitian";

// UserManagement drives the Dietitians section through these Server Actions
// and the Admin Users section through adminActions — both are stubbed so the
// suite exercises only the client-side partitioning and rendering logic.
const listDietitians = vi.fn();
const listClinicsForDietitianAssignment = vi.fn(async () => ({
  success: true as const,
  data: [],
}));
vi.mock("@/actions/master-actions/dietitianActions", () => ({
  listDietitians: (...args: unknown[]) =>
    (listDietitians as unknown as (...a: unknown[]) => unknown)(...args),
  listClinicsForDietitianAssignment: (...args: unknown[]) =>
    (listClinicsForDietitianAssignment as unknown as (...a: unknown[]) => unknown)(
      ...args,
    ),
  createDietitian: vi.fn(),
  updateDietitian: vi.fn(),
  toggleDietitianActive: vi.fn(),
}));

vi.mock("@/actions/master-actions/adminActions", () => ({
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
  toggleAdminActive: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported after the mocks above so the component picks up the mocked
// Server Actions rather than the real ones.
const { default: UserManagement } = await import(
  "@/shared/components/master/UserManagement"
);

interface RawUserFixture {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  rawAccessLevel: unknown;
  isActive: boolean;
  createdAt: string;
}

/**
 * One fixture per index. The index is baked into the name/email so no two
 * generated users can collide on the text a `getByText` query matches
 * against, whatever `rawAccessLevelArb` happens to produce — collisions would
 * make the per-user exclusivity assertions ambiguous rather than testing the
 * partition itself.
 */
function userFixtureArb(index: number): fc.Arbitrary<RawUserFixture> {
  return fc.tuple(rawAccessLevelArb, fc.boolean()).map(
    ([rawAccessLevel, isActive]): RawUserFixture => ({
      id: `user-${index}`,
      fullName: `Fixture User ${index}`,
      email: `fixture-user-${index}@example.com`,
      mobile: "9000000000",
      rawAccessLevel,
      isActive,
      createdAt: "2025-01-15T00:00:00.000Z",
    }),
  );
}

/** 0 to 10 users, each with an independently drawn raw Access_Level. */
const usersArb: fc.Arbitrary<RawUserFixture[]> = fc
  .integer({ min: 0, max: 10 })
  .chain((count) =>
    count === 0
      ? fc.constant<RawUserFixture[]>([])
      : fc.tuple(...Array.from({ length: count }, (_, i) => userFixtureArb(i))),
  );

function toAdminRow(user: RawUserFixture) {
  return {
    id: user.id,
    auth_user_id: `${user.id}-auth`,
    full_name: user.fullName,
    email: user.email,
    mobile: user.mobile,
    is_active: user.isActive,
    created_at: user.createdAt,
    admin_access_level: user.rawAccessLevel as string | null,
    admin_operations_access: null,
  };
}

function toDietitianAccount(user: RawUserFixture): DietitianAccount {
  return {
    id: user.id,
    authUserId: `${user.id}-auth`,
    fullName: user.fullName,
    email: user.email,
    mobile: user.mobile,
    roleCode: "ADMIN",
    clinicId: null,
    clinicName: null,
    franchiseId: null,
    franchiseName: null,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

// Each run mounts the full User Management page (two tables, a warning
// banner, and the load-on-mount Dietitians fetch), which is comparatively
// slow in jsdom.
const NUM_RUNS = 20;

describe("Property 14: Dietitians are partitioned out of the Admin Users list", () => {
  it("places every user in exactly one of the Admin Users / Dietitians tables, matching its resolved Access_Level", async () => {
    /**
     * **Validates: Requirements 3.1, 3.2**
     */
    await fc.assert(
      fc.asyncProperty(usersArb, async (users) => {
        cleanup();
        listDietitians.mockReset();
        listClinicsForDietitianAssignment.mockClear();

        const dietitianUsers = users.filter(
          (u) => resolveAccessLevel(u.rawAccessLevel) === DIETITIAN_ACCESS_LEVEL,
        );
        const adminUsers = users.filter(
          (u) => resolveAccessLevel(u.rawAccessLevel) !== DIETITIAN_ACCESS_LEVEL,
        );

        listDietitians.mockResolvedValue({
          success: true,
          data: dietitianUsers.map(toDietitianAccount),
        });

        render(<UserManagement initialAdmins={users.map(toAdminRow)} />);

        // Wait for the Dietitians section's load-on-mount effect to settle
        // before asserting on its table content.
        await waitFor(() => expect(listDietitians).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(screen.queryByText(/loading dietitians/i)).not.toBeInTheDocument(),
        );

        const tables = screen.getAllByRole("table");
        expect(tables).toHaveLength(2);
        const [adminTable, dietitianTable] = tables;

        // Exhaustive + mutually exclusive: every admin user's email appears
        // in the Admin Users table exactly once and never in the Dietitians
        // table; every dietitian user's email appears in the Dietitians
        // table exactly once and never in the Admin Users table. Together
        // these forall-checks cover every generated user exactly once, since
        // `adminUsers`/`dietitianUsers` partition `users` by construction.
        for (const user of adminUsers) {
          expect(within(adminTable).getAllByText(user.email)).toHaveLength(1);
          expect(within(dietitianTable).queryAllByText(user.email)).toHaveLength(0);
        }
        for (const user of dietitianUsers) {
          expect(within(dietitianTable).getAllByText(user.email)).toHaveLength(1);
          expect(within(adminTable).queryAllByText(user.email)).toHaveLength(0);
        }

        cleanup();
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60000);
});
