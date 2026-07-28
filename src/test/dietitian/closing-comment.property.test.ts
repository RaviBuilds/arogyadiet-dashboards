// src/test/dietitian/closing-comment.property.test.ts
// Feature: dietitian-management, Property 19
//
// Property 19: The Closing_Comment is mandatory and length-bounded.
//
// For any submitted Closing_Comment, the submission is accepted iff the trimmed
// comment is 1–2000 characters; an empty or whitespace-only comment is rejected
// with the pinned message `A closing comment is required` (Req 13.2) and a
// comment longer than 2000 characters after trimming is rejected (Req 13.3).
//
// The rest of the payload is always otherwise valid — Customer_Category from
// `customerCategoryArb`, a sparse in-range parameter map from
// `sparseParameterMapArb`, and a unique Custom_Parameter list — so the only
// thing that can decide the outcome is the comment itself.
//
// The bound is a character count, so the generators build comments out of a
// mixed ASCII / non-ASCII single-code-unit alphabet and measure them with
// `String.prototype.length`; padding is added around a non-whitespace core so
// the trimmed length is exactly the intended one.
//
// **Validates: Requirements 13.2, 13.3**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  CLOSING_COMMENT_MAX_LENGTH,
  CLOSING_COMMENT_MIN_LENGTH,
  CLOSING_COMMENT_TOO_LONG,
  healthLogSchemaFor,
  type HealthLogInput,
} from "@/validations/healthLogSchema";
import { CLOSING_COMMENT_REQUIRED } from "@/lib/dietitian/messages";
import {
  customerCategoryArb,
  fixtureUuid,
  istDateArb,
  sparseParameterMapArb,
  uniqueCustomParameterListArb,
} from "@/test/dietitian/arbitraries";
import type { CustomerCategory } from "@/types/dietitian";

const NUM_RUNS = 200;

// ─── Comment generators ──────────────────────────────────────────────────────

/**
 * Single-UTF-16-code-unit characters, ASCII and non-ASCII, none of them
 * whitespace: a comment built from this alphabet has `length` equal to its
 * character count and is unchanged by trimming.
 */
const COMMENT_ALPHABET = [
  "a",
  "Q",
  "9",
  ".",
  "é",
  "ñ",
  "ß",
  "क",
  "श",
  "文",
  "漢",
  "→",
] as const;

/** Builds a string of exactly `length` characters by cycling `seed`. */
function stringOfLength(seed: readonly string[], length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += seed[i % seed.length];
  return out;
}

/** A non-blank comment core of exactly `length` characters. */
function commentOfLengthArb(length: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...COMMENT_ALPHABET), { minLength: 1, maxLength: 12 })
    .map((seed) => stringOfLength(seed, length));
}

/** Whitespace runs used as padding — trimming must remove all of them. */
const WHITESPACE_PADDING_ARB: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), { maxLength: 6 })
  .map((chars) => chars.join(""));

/** Wraps a core in optional leading and trailing whitespace. */
function paddedArb(core: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc
    .tuple(WHITESPACE_PADDING_ARB, core, WHITESPACE_PADDING_ARB)
    .map(([lead, body, trail]) => `${lead}${body}${trail}`);
}

/** In-bound lengths, biased to both boundaries (1 and 2000). */
const IN_BOUND_LENGTH_ARB: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      CLOSING_COMMENT_MIN_LENGTH,
      CLOSING_COMMENT_MIN_LENGTH + 1,
      CLOSING_COMMENT_MAX_LENGTH - 1,
      CLOSING_COMMENT_MAX_LENGTH,
    ),
    weight: 3,
  },
  {
    arbitrary: fc.integer({
      min: CLOSING_COMMENT_MIN_LENGTH,
      max: CLOSING_COMMENT_MAX_LENGTH,
    }),
    weight: 4,
  },
);

/** Over-bound lengths, biased to the first failing length (2001). */
const OVER_BOUND_LENGTH_ARB: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      CLOSING_COMMENT_MAX_LENGTH + 1,
      CLOSING_COMMENT_MAX_LENGTH + 2,
    ),
    weight: 3,
  },
  {
    arbitrary: fc.integer({
      min: CLOSING_COMMENT_MAX_LENGTH + 1,
      max: CLOSING_COMMENT_MAX_LENGTH + 500,
    }),
    weight: 2,
  },
);

/** A comment that is empty or whitespace-only, plus the absent/null cases. */
const BLANK_COMMENT_ARB: fc.Arbitrary<string | null | undefined> = fc.oneof(
  { arbitrary: fc.constant<string | null | undefined>(undefined), weight: 1 },
  { arbitrary: fc.constant<string | null | undefined>(null), weight: 1 },
  { arbitrary: fc.constant<string | null | undefined>(""), weight: 1 },
  {
    arbitrary: fc
      .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
        minLength: 1,
        maxLength: 10,
      })
      .map((chars): string | null | undefined => chars.join("")),
    weight: 3,
  },
);

// ─── Otherwise-valid payloads ────────────────────────────────────────────────

interface PayloadBase {
  category: CustomerCategory;
  payload: Omit<HealthLogInput, "closingComment">;
}

/**
 * An otherwise-valid Health_Log payload with the Closing_Comment left out, so
 * each property can drop its own comment in.
 */
const payloadBaseArb: fc.Arbitrary<PayloadBase> = customerCategoryArb.chain(
  (category) =>
    fc
      .record({
        seq: fc.integer({ min: 1, max: 9_999 }),
        logDate: istDateArb,
        parameters: sparseParameterMapArb(category),
        customParameters: uniqueCustomParameterListArb({ maxLength: 5 }),
      })
      .map(({ seq, logDate, parameters, customParameters }) => ({
        category,
        payload: {
          customerProfileId: fixtureUuid(44, seq),
          logDate,
          parameters,
          customParameters,
        },
      })),
);

/** Every message reported against the `closingComment` path. */
function closingCommentErrors(
  category: CustomerCategory,
  payload: unknown,
): string[] {
  const result = healthLogSchemaFor(category).safeParse(payload);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === "closingComment")
    .map((issue) => issue.message);
}

// ─── The property ────────────────────────────────────────────────────────────

describe("Property 19: the Closing_Comment is mandatory and length-bounded", () => {
  it("rejects a missing, null, empty or whitespace-only comment with the pinned message", () => {
    fc.assert(
      fc.property(payloadBaseArb, BLANK_COMMENT_ARB, (base, closingComment) => {
        const input = { ...base.payload, closingComment };
        const result = healthLogSchemaFor(base.category).safeParse(input);

        expect(result.success).toBe(false);
        expect(closingCommentErrors(base.category, input)).toContain(
          CLOSING_COMMENT_REQUIRED,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts a comment of 1 to 2000 characters after trimming, including both boundaries", () => {
    fc.assert(
      fc.property(
        payloadBaseArb,
        IN_BOUND_LENGTH_ARB.chain((length) =>
          paddedArb(commentOfLengthArb(length)).map((comment) => ({
            comment,
            length,
          })),
        ),
        (base, { comment, length }) => {
          // Pre-condition on the generator: trimming yields exactly `length`.
          expect(comment.trim().length).toBe(length);

          const result = healthLogSchemaFor(base.category).safeParse({
            ...base.payload,
            closingComment: comment,
          });

          expect(result.success).toBe(true);
          if (result.success) {
            // The stored comment is the trimmed one, exactly once (Req 13.4).
            expect(result.data.closingComment).toBe(comment.trim());
            expect(result.data.closingComment.length).toBe(length);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a comment longer than 2000 characters after trimming", () => {
    fc.assert(
      fc.property(
        payloadBaseArb,
        OVER_BOUND_LENGTH_ARB.chain((length) =>
          paddedArb(commentOfLengthArb(length)).map((comment) => ({
            comment,
            length,
          })),
        ),
        (base, { comment, length }) => {
          expect(comment.trim().length).toBe(length);

          const input = { ...base.payload, closingComment: comment };
          const result = healthLogSchemaFor(base.category).safeParse(input);

          expect(result.success).toBe(false);
          expect(closingCommentErrors(base.category, input)).toContain(
            CLOSING_COMMENT_TOO_LONG,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
