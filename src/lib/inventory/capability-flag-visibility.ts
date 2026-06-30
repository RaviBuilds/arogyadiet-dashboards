/**
 * Pure control-visibility logic for the inventory capability-flag gating.
 *
 * This module extracts the conditional rendering decisions from
 * InventoryDashboard and ProductCard into a pure, testable function.
 * The actual components use these same branching rules inline
 * (productManagement && ...) — this helper models that logic so it can
 * be property-tested without requiring a DOM or React rendering.
 */

export type InventoryControl =
  | "register-product" // RegisterProductSheet (hero CTA + empty-state CTAs)
  | "edit-product" // MoreVertical dropdown → Edit Profile
  | "delete-product" // MoreVertical dropdown → Delete Product
  | "receive-stock" // Receive button (always present)
  | "dispatch-stock"; // Dispatch button (always present)

export interface VisibilityResult {
  register: boolean;
  edit: boolean;
  delete: boolean;
  receive: boolean;
  dispatch: boolean;
}

/**
 * Resolves which inventory controls are visible given the capability flag.
 *
 * Models the exact conditional logic from:
 * - InventoryDashboard: `{productManagement && <RegisterProductSheet />}`
 * - ProductCard: `{productManagement && (<DropdownMenu>...Edit/Delete...)}`
 * - ProductCard: Receive/Dispatch are always rendered (no condition)
 *
 * @param productManagement - The capability flag value. undefined means omitted.
 * @returns Which controls are visible.
 */
export function resolveControlVisibility(
  productManagement: boolean | undefined,
): VisibilityResult {
  // The components default productManagement to false when omitted
  const flag = productManagement ?? false;

  return {
    register: flag,
    edit: flag,
    delete: flag,
    // Receive/Dispatch are ALWAYS present regardless of the flag
    receive: true,
    dispatch: true,
  };
}
