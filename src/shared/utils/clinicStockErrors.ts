/**
 * Clinic Shop Stock RPC error-prefix → user-facing message mapping.
 *
 * Extracted from clinicShopInventoryActions.ts so it can be used in both the
 * server-actions file ("use server" requires all exports to be async) and
 * in unit tests that exercise the mapping logic directly.
 */

const CLINIC_STOCK_ERROR_PREFIXES: {
  prefix: string;
  format: (detail: string) => string;
}[] = [
  {
    // Req 7.12
    prefix: "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
    format: (detail) => `Insufficient warehouse stock: ${detail}`,
  },
  {
    // Req 7.14, 18.8
    prefix: "CLINIC_STOCK_EXCEEDS_MAXIMUM:",
    format: (detail) =>
      `The maximum stock quantity is 1,000,000: ${detail}`,
  },
  {
    // Req 7.15, 18.9
    prefix: "CLINIC_STOCK_UNLINKED_PRODUCT:",
    format: (detail) =>
      `Product must be linked to a Master Catalog Product before stock-in: ${detail}`,
  },
  {
    // Req 11.1, 15.10
    prefix: "CLINIC_STOCK_INSUFFICIENT_CLINIC:",
    format: (detail) => `Insufficient clinic stock: ${detail}`,
  },
  {
    // Req 2.9
    prefix: "CLINIC_STOCK_LEDGER_IMMUTABLE:",
    format: () => "Ledger entries are immutable and cannot be changed.",
  },
  {
    // Req 10.12
    prefix: "CLINIC_STAMP_IMMUTABLE:",
    format: () => "The clinic stamp cannot be changed.",
  },
  {
    // Req 8.3
    prefix: "CLINIC_STOCK_INCREASE_FORBIDDEN:",
    format: () =>
      "Clinic shop stock can only be increased through a Stock In.",
  },
  {
    // Req 1.9, 13.12
    prefix: "CLINIC_NOT_CORE:",
    format: () => "Clinic Shop Stock applies to Core Clinics only.",
  },
  {
    // Req 1.2, 2.4, 3.8
    prefix: "CLINIC_REFERENCE_NOT_FOUND:",
    format: (detail) => `Reference not found: ${detail}`,
  },
  {
    // The clinic RPCs reject a franchise id passed as the destination
    // outright (Req 19.4, 19.9); equivalent in effect to CLINIC_NOT_CORE:.
    prefix: "CLINIC_STOCK_FRANCHISE_DESTINATION:",
    format: () =>
      "Clinic Shop Stock applies to Core Clinics only; use the franchise Stock In action instead.",
  },
  {
    // Empty submission / malformed line shape (Req 7.5).
    prefix: "CLINIC_STOCK_INVALID_SUBMISSION:",
    format: (detail) => `Invalid submission: ${detail}`,
  },
  {
    // Req 7.13, 10.7: mirrors movementQuantitySchema's wording exactly, since
    // the RPC re-checks the same rule under a row lock.
    prefix: "CLINIC_STOCK_INVALID_QUANTITY:",
    format: () => "Quantity must be a whole number between 1 and 1,000,000",
  },
];

/**
 * Map a thrown error's message to the requirement's specified user-facing
 * wording, matching by the stable prefix embedded anywhere in the message
 * (the repository layer prepends its own "Failed to ..." context, so the
 * prefix is searched for rather than required at the start). Falls back to a
 * generic message when no known prefix is present.
 */
export function mapClinicStockRpcError(rawMessage: unknown): string {
  const message = typeof rawMessage === "string" ? rawMessage : "";
  for (const { prefix, format } of CLINIC_STOCK_ERROR_PREFIXES) {
    const index = message.indexOf(prefix);
    if (index !== -1) {
      return format(message.slice(index + prefix.length).trim());
    }
  }
  return "The operation could not be completed.";
}
