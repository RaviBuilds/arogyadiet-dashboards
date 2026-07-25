// src/actions/__tests__/profileCompletionActions.test.ts
// Feature: mandatory-profile-completion-popup
//
// Integration test for `markOnboardingCompletedAction` (Task 2.2). It verifies
// the session-authenticated action threads the MEAL/KIT medical payload into
// `OnboardingService.completeProfile` and that the medical fields land in the
// customer profile store, that a successful completion transitions
// `onboarding_status` IN_PROGRESS → COMPLETED (and revalidates the dashboard),
// and that a persistence failure leaves `onboarding_status` as IN_PROGRESS with
// no dashboard revalidation.
//
// This is a genuine integration test: the real `completeProfile` orchestration
// runs; only the data-access layer (`customerOnboardingRepository`), the
// Supabase server client (session identity), and `next/cache` are replaced with
// in-memory fakes / spies — so we assert on the actual persisted profile row,
// not just on mocked call args.
//
// Validates: Requirements 2.6, 4.2, 4.3, 4.4
//
// Tooling: vitest.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── In-memory test harness (mutated per-test) ──────────────────────────────
// Hoisted so the module mocks below can close over it.
const h = vi.hoisted(() => {
  return {
    // The authenticated auth user (null → unauthenticated).
    authUser: { current: { id: "auth-1" } as { id: string } | null },
    // Session-resolved identities returned by the users / customer_profiles maps.
    dbUserId: { current: "db-user-1" as string | null },
    profileId: { current: "profile-1" as string | null },
    // The single customer profile row under test.
    profile: {
      current: {
        id: "profile-1",
        onboarding_status: "IN_PROGRESS",
      } as Record<string, unknown>,
    },
    // When true, `updateProfileFields` throws to model a persistence failure.
    failPersistence: { current: false },
    // Spy for next/cache revalidation.
    revalidateSpy: vi.fn(),
  };
});

// ─── Mock: data-access layer (in-memory profile store) ───────────────────────
// `updateProfileFields` applies the service's snake_case patch onto the profile
// row (or throws when `failPersistence` is set). `setOnboardingCompleted` flips
// the status to COMPLETED. Onboarding-only exports are stubbed so the module
// binds even though this test never calls them.
vi.mock("@/repositories/customerOnboardingRepository", () => ({
  updateProfileFields: vi.fn(
    async (profileId: string, patch: Record<string, unknown>) => {
      if (h.failPersistence.current) {
        throw new Error("simulated persistence failure");
      }
      if (profileId === h.profile.current.id) {
        Object.assign(h.profile.current, patch);
      }
    }
  ),
  setOnboardingCompleted: vi.fn(async (profileId: string) => {
    if (profileId === h.profile.current.id) {
      h.profile.current.onboarding_status = "COMPLETED";
    }
  }),
  replaceTestEmailWithReal: vi.fn(async () => ({ ok: true })),
  generateUniqueCustomerCode: vi.fn(),
  onboardCustomerAtomic: vi.fn(),
}));

// ─── Mock: Supabase server client (session → identity resolution) ────────────
// Mirrors `resolveAuthenticatedCustomer`: getUser → users(id) → customer_profiles(id).
vi.mock("@/lib/supabase/server", () => {
  function makeMaybeSingle(table: string) {
    return async () => {
      if (table === "users") {
        return h.dbUserId.current
          ? { data: { id: h.dbUserId.current }, error: null }
          : { data: null, error: null };
      }
      // customer_profiles
      return h.profileId.current
        ? { data: { id: h.profileId.current }, error: null }
        : { data: null, error: null };
    };
  }

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: h.authUser.current }, error: null }),
      },
      from: (table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: makeMaybeSingle(table),
        };
        return builder;
      },
    }),
  };
});

// ─── Mock: Next.js cache revalidation (spy only) ─────────────────────────────
vi.mock("next/cache", () => ({
  revalidatePath: h.revalidateSpy,
}));

// System under test — imported AFTER the mocks are registered.
import { markOnboardingCompletedAction } from "@/actions/profileCompletionActions";

beforeEach(() => {
  h.authUser.current = { id: "auth-1" };
  h.dbUserId.current = "db-user-1";
  h.profileId.current = "profile-1";
  h.profile.current = { id: "profile-1", onboarding_status: "IN_PROGRESS" };
  h.failPersistence.current = false;
  h.revalidateSpy.mockReset();
});

describe("markOnboardingCompletedAction — medical payload threading (Task 2.2)", () => {
  it("threads medical documents + notes into completeProfile and persists them on success", async () => {
    const medicalDocuments = [
      { name: "report.pdf", url: "auth-1/abc.pdf", type: "application/pdf" },
      { name: "scan.png", url: "auth-1/def.png", type: "image/png" },
    ];

    const result = await markOnboardingCompletedAction(
      { medicalHistoryNotes: "  Type 2 diabetes  " },
      { medicalHistoryConfirmed: false, medicalDocuments }
    );

    // Success + transition to COMPLETED (Req 2.5).
    expect(result).toEqual({ success: true, completed: true });
    expect(h.profile.current.onboarding_status).toBe("COMPLETED");

    // Medical documents persisted verbatim to the JSONB field (Req 4.2).
    expect(h.profile.current.medical_documents).toEqual(medicalDocuments);

    // Medical history persisted: trimmed notes, confirmation false (Req 4.3).
    expect(h.profile.current.medical_history_notes).toBe("Type 2 diabetes");
    expect(h.profile.current.medical_history_confirmed).toBe(false);

    // Dashboard revalidated so the dialog stops reappearing.
    expect(h.revalidateSpy).toHaveBeenCalledWith("/dashboard");
  });

  it("persists an empty medical_documents field and cleared notes when 'no medical history' is confirmed", async () => {
    const result = await markOnboardingCompletedAction(
      { medicalHistoryNotes: "ignored when confirmed" },
      { medicalHistoryConfirmed: true, medicalDocuments: [] }
    );

    expect(result).toEqual({ success: true, completed: true });
    // Confirmation clears the notes and sets the flag (Req 4.3).
    expect(h.profile.current.medical_history_notes).toBeNull();
    expect(h.profile.current.medical_history_confirmed).toBe(true);
    // Empty/absent documents persist an empty field (Req 4.5).
    expect(h.profile.current.medical_documents).toEqual([]);
    expect(h.profile.current.onboarding_status).toBe("COMPLETED");
  });

  it("enforces the mandatory medical-history rule server-side (requireMedicalHistory threaded)", async () => {
    // No notes and no confirmation → the threaded `requireMedicalHistory: true`
    // must reject with a medicalHistoryNotes field error, persisting nothing and
    // leaving the status IN_PROGRESS (Req 2.6, 4.4).
    const result = await markOnboardingCompletedAction(
      {},
      { medicalHistoryConfirmed: false, medicalDocuments: [] }
    );

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.fieldErrors).toHaveProperty("medicalHistoryNotes");
    }
    expect(h.profile.current.onboarding_status).toBe("IN_PROGRESS");
    expect(h.profile.current.medical_documents).toBeUndefined();
    expect(h.revalidateSpy).not.toHaveBeenCalled();
  });

  it("leaves onboarding_status IN_PROGRESS and does not revalidate when persistence fails", async () => {
    h.failPersistence.current = true;

    const result = await markOnboardingCompletedAction(
      { medicalHistoryNotes: "asthma" },
      {
        medicalHistoryConfirmed: false,
        medicalDocuments: [
          { name: "r.pdf", url: "auth-1/r.pdf", type: "application/pdf" },
        ],
      }
    );

    // A persistence failure surfaces an error (Req 4.4)…
    expect("error" in result).toBe(true);
    // …and the record is NOT completed — status stays IN_PROGRESS (Req 2.6/4.4).
    expect(h.profile.current.onboarding_status).toBe("IN_PROGRESS");
    // No dashboard revalidation happens on failure (completion did not occur).
    expect(h.revalidateSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the caller is unauthenticated", async () => {
    h.authUser.current = null;

    const result = await markOnboardingCompletedAction(
      { medicalHistoryNotes: "note" },
      { medicalHistoryConfirmed: false, medicalDocuments: [] }
    );

    expect(result).toEqual({ error: "Unauthorized" });
    expect(h.profile.current.onboarding_status).toBe("IN_PROGRESS");
    expect(h.revalidateSpy).not.toHaveBeenCalled();
  });
});
