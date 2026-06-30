// src/lib/franchise-inventory/permissions.ts
// Pure permission predicate for franchise-portal actions.
// Permits only stock movement actions; denies all product management.
// Requirements validated: 4.1, 4.2, 4.3

export type FranchiseAction =
  | 'STOCK_IN_CONFIRM'
  | 'STOCK_OUT_RECORD'
  | 'PRODUCT_CREATE'
  | 'PRODUCT_EDIT'
  | 'PRODUCT_DELETE';

const PERMITTED_ACTIONS: FranchiseAction[] = ['STOCK_IN_CONFIRM', 'STOCK_OUT_RECORD'];

export type PermissionResult =
  | { permitted: true }
  | { permitted: false; error: string };

/**
 * Checks whether a franchise-portal action is permitted.
 *
 * Only Stock_In confirmation and Stock_Out recording are allowed.
 * All product-management actions (create, edit, delete) are denied.
 */
export function checkFranchisePermission(action: string): PermissionResult {
  if ((PERMITTED_ACTIONS as string[]).includes(action)) {
    return { permitted: true };
  }

  return {
    permitted: false,
    error: `Action "${action}" is not permitted. Franchise operators may only confirm stock-in and record stock-out.`,
  };
}
