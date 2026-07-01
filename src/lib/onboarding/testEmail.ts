// src/lib/onboarding/testEmail.ts
// Pure helpers for the mobile-first, placeholder-email identity model.
//
// `users.email` is NOT NULL + UNIQUE, but a clinic customer may have no email.
// When the admin supplies none, onboarding writes a deterministic placeholder
// derived from the (unique) normalized mobile and flags it with
// `is_test_email = true`. Because it is derived from the unique mobile and uses
// a reserved internal domain, the placeholder never collides with a real email
// and is hidden from the customer until a real email replaces it.
//
// Requirements validated: 10.4

/** Reserved internal domain for placeholder (test) emails — never a real inbox. */
export const PLACEHOLDER_EMAIL_DOMAIN = "placeholder.arogyadiet.internal";

/**
 * Builds the deterministic placeholder email for a normalized 10-digit mobile:
 *
 *   m<normalizedMobile>@placeholder.arogyadiet.internal
 *
 * The `normalizedMobile` is expected to already be canonical (10 digits). Any
 * non-digit characters are stripped defensively so the result is stable and
 * unique per mobile.
 */
export function placeholderEmailFor(normalizedMobile: string): string {
  const digits = normalizedMobile.replace(/\D/g, "");
  return `m${digits}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/** The minimal user shape needed to decide email displayability. */
export interface UserEmailFields {
  email: string | null;
  is_test_email: boolean;
}

/**
 * Pure predicate for customer-facing email display (Req 10.4).
 *
 * Returns `true` only when the user's email is a real, customer-provided
 * address — i.e. it is present and NOT flagged as a Test_Email. While the email
 * is flagged as a placeholder, it must be excluded from any customer-facing
 * display, so this returns `false`.
 */
export function isDisplayableEmail(user: UserEmailFields): boolean {
  return !user.is_test_email && !!user.email && user.email.length > 0;
}

/**
 * Convenience: the value to show a customer for their email — the real email
 * when displayable, otherwise `null` so the UI can render an "add email" prompt
 * rather than leaking the placeholder.
 */
export function displayableEmailOrNull(user: UserEmailFields): string | null {
  return isDisplayableEmail(user) ? user.email : null;
}
