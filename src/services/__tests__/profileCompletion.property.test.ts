// src/services/__tests__/profileCompletion.property.test.ts
// Feature: customer-mobile-onboarding
//
// This file hosts the two profile-completion correctness properties from the
// design ("Correctness Properties"), both exercising the OnboardingService
// entry points `completeProfile` and `shouldShowProfileCompletionDialog`
// (`src/services/OnboardingService.ts`). The data-access layer
// (`@/repositories/customerOnboardingRepository`) is replaced with in-memory
// fakes so the pure decision + orchestration logic is tested in isolation,
// across many generated inputs, without any Supabase / network I/O.
//
//   - Property 14: Profile-completion optional-field validation and persistence
//   - Property 15: Onboarding status drives completion and dialog visibility
//
// Tooling: vitest + fast-check (min 100 runs per property, per design).

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Replace the whole repository module with in-memory fakes. The three writes
// the service invokes are the only side-effect surface; mocking them keeps the
// real `profileCompletionSchema` validation and the service orchestration under
// test while removing Supabase / `server-only` imports. Onboarding-only exports
// are stubbed too so the module binds cleanly even though we never call them.
vi.mock("@/repositories/customerOnboardingRepository", () => ({
  updateProfileFields: vi.fn(),
  setOnboardingCompleted: vi.fn(),
  replaceTestEmailWithReal: vi.fn(),
  generateUniqueCustomerCode: vi.fn(),
  onboardCustomerAtomic: vi.fn(),
}));

import {
  completeProfile,
  shouldShowProfileCompletionDialog,
} from "@/services/OnboardingService";
import {
  updateProfileFields,
  setOnboardingCompleted,
  replaceTestEmailWithReal,
} from "@/repositories/customerOnboardingRepository";

// ─── Field model ────────────────────────────────────────────────────────────
// A generated "cell" for a profile-completion field: it is either omitted from
// the submission, present-and-valid, or present-and-invalid. This lets each
// property vary "any subset of displayed fields (including empty)" while
// tracking which provided values pass or fail their format rule.
type Cell =
  | { include: false }
  | { include: true; valid: boolean; value: unknown };

// The camelCase dialog field names and their matching persisted columns. `email`
// is persisted to `users` (via replaceTestEmailWithReal); the rest map to
// `customer_profiles` columns through the service's snake_case patch.
const PROFILE_FIELDS = [
  "dateOfBirth",
  "gender",
  "dietaryPreference",
  "allergies",
  "medicalHistoryNotes",
] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];

const COLUMN_OF: Record<ProfileField, string> = {
  dateOfBirth: "date_of_birth",
  gender: "gender",
  dietaryPreference: "dietary_preference",
  allergies: "allergies",
  medicalHistoryNotes: "medical_history_notes",
};

// ─── Value arbitraries ───────────────────────────────────────────────────────
// Short ASCII text, guaranteed within any small length bound (avoids UTF-16
// surrogate-pair surprises when asserting max-length validity).
const arbAscii = (maxLength: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(..."abcdefghijklmnop ,.-".split("")), {
      maxLength,
    })
    .map((chars) => chars.join(""));

const VALID: Record<ProfileField, fc.Arbitrary<unknown>> = {
  // Matches /^\d{4}-\d{2}-\d{2}$/.
  dateOfBirth: fc
    .tuple(
      fc.integer({ min: 1900, max: 2099 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 })
    )
    .map(
      ([y, m, d]) =>
        `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    ),
  gender: fc.constantFrom("Male", "Female", "Other"),
  dietaryPreference: fc.constantFrom("Veg", "Non-Veg"),
  allergies: arbAscii(120), // .max(500) → any short ASCII string is valid
  medicalHistoryNotes: arbAscii(120), // .max(2000)
};

const INVALID: Record<ProfileField, fc.Arbitrary<unknown>> = {
  // Wrong shape / separators / lengths — never matches the DOB regex.
  dateOfBirth: fc.constantFrom(
    "2020/01/01",
    "01-01-2020",
    "2020-1-1",
    "not-a-date",
    "20200101",
    ""
  ),
  gender: fc.constantFrom("male", "MALE", "M", "Unknown", "female", ""),
  dietaryPreference: fc.constantFrom("veg", "Vegan", "NonVeg", "non-veg", ""),
  // Exceeds .max(500).
  allergies: fc
    .integer({ min: 501, max: 600 })
    .map((n) => "a".repeat(n)),
  // Exceeds .max(2000).
  medicalHistoryNotes: fc
    .integer({ min: 2001, max: 2100 })
    .map((n) => "b".repeat(n)),
};

// A cell for one field: omitted, present+valid, or present+invalid.
const arbCell = (field: ProfileField): fc.Arbitrary<Cell> =>
  fc.oneof(
    { weight: 1, arbitrary: fc.constant<Cell>({ include: false }) },
    {
      weight: 2,
      arbitrary: VALID[field].map<Cell>((value) => ({
        include: true,
        valid: true,
        value,
      })),
    },
    {
      weight: 2,
      arbitrary: INVALID[field].map<Cell>((value) => ({
        include: true,
        valid: false,
        value,
      })),
    }
  );

// A lowercase alphanumeric token (1..20 chars) — safe for both the email local
// part and domain label under any reasonable email validator.
const arbAlnum = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .map((chars) => chars.join(""));

// A definitively valid email: `local@domain.tld` from safe tokens. Built
// (rather than using fc.emailAddress) so the generated value is accepted by the
// schema's `.email()` rule — fast-check's RFC-permissive addresses are not all
// accepted by the stricter Zod validator.
const arbValidEmail: fc.Arbitrary<string> = fc
  .tuple(arbAlnum, arbAlnum, fc.constantFrom("com", "org", "net", "io", "co"))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// A valid email cell (format-passing), plus omit / invalid variants.
const arbEmailCell: fc.Arbitrary<Cell> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<Cell>({ include: false }) },
  {
    weight: 2,
    arbitrary: arbValidEmail.map<Cell>((value) => ({
      include: true,
      valid: true,
      value,
    })),
  },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom("notanemail", "foo@", "@bar.com", "a b@c.com", "")
      .map<Cell>((value) => ({ include: true, valid: false, value })),
  }
);

interface BuiltSubmission {
  input: Record<string, unknown>;
  presentProfile: ProfileField[]; // profile fields included in the submission
  invalidFields: string[]; // camelCase names of provided-but-invalid fields
  emailCell: Cell;
}

// Assemble a submission object + metadata from the generated cells.
function build(
  cells: Record<ProfileField, Cell>,
  emailCell: Cell
): BuiltSubmission {
  const input: Record<string, unknown> = {};
  const presentProfile: ProfileField[] = [];
  const invalidFields: string[] = [];

  for (const field of PROFILE_FIELDS) {
    const cell = cells[field];
    if (cell.include) {
      input[field] = cell.value;
      presentProfile.push(field);
      if (!cell.valid) invalidFields.push(field);
    }
  }
  if (emailCell.include) {
    input.email = emailCell.value;
    if (!emailCell.valid) invalidFields.push("email");
  }

  return { input, presentProfile, invalidFields, emailCell };
}

const arbCells: fc.Arbitrary<Record<ProfileField, Cell>> = fc.record({
  dateOfBirth: arbCell("dateOfBirth"),
  gender: arbCell("gender"),
  dietaryPreference: arbCell("dietaryPreference"),
  allergies: arbCell("allergies"),
  medicalHistoryNotes: arbCell("medicalHistoryNotes"),
});

// =============================================================================
// Property 14: Profile-completion optional-field validation and persistence
// =============================================================================
// For any subset of displayed fields (including empty), submission is accepted
// when every provided value passes its format rule, and exactly those provided
// values are persisted to matching columns; if any provided value fails its
// format rule the submission is rejected, entered values retained, each invalid
// field identified.
//
// Validates: Requirements 9.2, 9.3, 9.7
describe("Property 14: Profile-completion optional-field validation and persistence", () => {
  beforeEach(() => {
    vi.mocked(updateProfileFields).mockReset().mockResolvedValue(undefined);
    vi.mocked(setOnboardingCompleted).mockReset().mockResolvedValue(undefined);
    vi.mocked(replaceTestEmailWithReal)
      .mockReset()
      .mockResolvedValue({ ok: true });
  });

  it("accepts any all-valid subset and persists exactly the provided values to matching columns", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        arbCells,
        arbEmailCell,
        async (profileId, userId, cells, emailCell) => {
          const { input, presentProfile, invalidFields, emailCell: em } =
            build(cells, emailCell);

          // Restrict this property to submissions where every provided value is
          // valid — the acceptance-and-persistence half of Property 14.
          fc.pre(invalidFields.length === 0);

          vi.mocked(updateProfileFields).mockClear();
          vi.mocked(replaceTestEmailWithReal).mockClear();

          const result = await completeProfile(profileId, input, { userId });

          // Submission is accepted (Req 9.2).
          expect(result.ok).toBe(true);

          // Exactly the provided profile values are persisted to their matching
          // snake_case columns — and no others (Req 9.3).
          expect(updateProfileFields).toHaveBeenCalledTimes(1);
          const [calledProfileId, patch] =
            vi.mocked(updateProfileFields).mock.calls[0];
          expect(calledProfileId).toBe(profileId);

          const expectedPatch: Record<string, unknown> = {};
          for (const field of presentProfile) {
            expectedPatch[COLUMN_OF[field]] = input[field];
          }
          expect(patch).toEqual(expectedPatch);

          // A provided real email is persisted to `users` (matching column),
          // not folded into the profile patch.
          if (em.include) {
            expect(replaceTestEmailWithReal).toHaveBeenCalledWith(
              userId,
              em.value
            );
            expect(patch).not.toHaveProperty("email");
          } else {
            expect(replaceTestEmailWithReal).not.toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 25 }
    );
  });

  it("rejects when any provided value is invalid, identifies each invalid field, and persists nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        arbCells,
        arbEmailCell,
        async (profileId, userId, cells, emailCell) => {
          const { input, invalidFields } = build(cells, emailCell);

          // Restrict to submissions with at least one invalid provided value —
          // the rejection half of Property 14.
          fc.pre(invalidFields.length > 0);

          vi.mocked(updateProfileFields).mockClear();
          vi.mocked(setOnboardingCompleted).mockClear();
          vi.mocked(replaceTestEmailWithReal).mockClear();

          const result = await completeProfile(profileId, input, { userId });

          // Rejected as a validation failure (Req 9.7).
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe("VALIDATION");
            // Each invalid field is identified — no more, no less. Valid
            // provided fields (and omitted ones) are not flagged.
            expect(result.fieldErrors).toBeDefined();
            const flagged = Object.keys(result.fieldErrors ?? {}).sort();
            expect(flagged).toEqual([...invalidFields].sort());
          }

          // Nothing is persisted: the entered values are retained by the dialog
          // and no partial write reaches any column (Req 9.3/9.7).
          expect(updateProfileFields).not.toHaveBeenCalled();
          expect(setOnboardingCompleted).not.toHaveBeenCalled();
          expect(replaceTestEmailWithReal).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 25 }
    );
  });
});

// =============================================================================
// Property 15: Onboarding status drives completion and dialog visibility
// =============================================================================
// Selecting "mark completed onboarding" transitions status to COMPLETED
// regardless of how many fields provided; the dialog is presented iff status is
// IN_PROGRESS.
//
// Validates: Requirements 9.4, 9.5, 14.1, 14.3

// A valid-only subset of profile fields (0..all), so "mark completed" always
// reaches the transition regardless of field count.
const arbValidSubset: fc.Arbitrary<{
  input: Record<string, unknown>;
  presentProfile: ProfileField[];
}> = fc
  .record({
    dateOfBirth: fc.option(VALID.dateOfBirth, { nil: undefined }),
    gender: fc.option(VALID.gender, { nil: undefined }),
    dietaryPreference: fc.option(VALID.dietaryPreference, { nil: undefined }),
    allergies: fc.option(VALID.allergies, { nil: undefined }),
    medicalHistoryNotes: fc.option(VALID.medicalHistoryNotes, {
      nil: undefined,
    }),
  })
  .map((raw) => {
    const input: Record<string, unknown> = {};
    const presentProfile: ProfileField[] = [];
    for (const field of PROFILE_FIELDS) {
      if (raw[field] !== undefined) {
        input[field] = raw[field];
        presentProfile.push(field);
      }
    }
    return { input, presentProfile };
  });

// Arbitrary onboarding-status value: the two enum states plus non-enum strings,
// null, and undefined — to stress the "iff IN_PROGRESS" gate.
const arbStatus: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constant("IN_PROGRESS"),
  fc.constant("COMPLETED"),
  fc.constant("PENDING"),
  fc.constant("in_progress"),
  fc.constant(""),
  fc.constant(null),
  fc.constant(undefined),
  fc.string()
);

describe("Property 15: Onboarding status drives completion and dialog visibility", () => {
  beforeEach(() => {
    vi.mocked(updateProfileFields).mockReset().mockResolvedValue(undefined);
    vi.mocked(setOnboardingCompleted).mockReset().mockResolvedValue(undefined);
    vi.mocked(replaceTestEmailWithReal)
      .mockReset()
      .mockResolvedValue({ ok: true });
  });

  it("presents the dialog iff onboarding status is IN_PROGRESS", () => {
    fc.assert(
      fc.property(arbStatus, (status) => {
        expect(shouldShowProfileCompletionDialog(status)).toBe(
          status === "IN_PROGRESS"
        );
      }),
      { numRuns: 25 }
    );
  });

  it("'mark completed' transitions status to COMPLETED regardless of how many fields are provided", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        arbValidSubset,
        async (profileId, { input }) => {
          vi.mocked(setOnboardingCompleted).mockClear();

          const result = await completeProfile(profileId, input, {
            markCompleted: true,
          });

          // Regardless of the number of fields provided (0..all), completion
          // succeeds and the status transition is performed (Req 9.4/14.3).
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.completed).toBe(true);
          }
          expect(setOnboardingCompleted).toHaveBeenCalledTimes(1);
          expect(setOnboardingCompleted).toHaveBeenCalledWith(profileId);
        }
      ),
      { numRuns: 25 }
    );
  });

  it("does NOT transition to COMPLETED when 'mark completed' is not selected", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        arbValidSubset,
        fc.boolean(),
        async (profileId, { input }, markCompleted) => {
          vi.mocked(setOnboardingCompleted).mockClear();

          const result = await completeProfile(profileId, input, {
            markCompleted,
          });

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.completed).toBe(markCompleted);
          }
          // The COMPLETED transition happens iff the caller asked for it — a
          // save-without-completing keeps the record IN_PROGRESS (Req 9.4).
          expect(setOnboardingCompleted).toHaveBeenCalledTimes(
            markCompleted ? 1 : 0
          );
        }
      ),
      { numRuns: 25 }
    );
  });
});
