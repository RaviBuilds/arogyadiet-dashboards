/**
 * Component tests for DispatchStockModal — no-active-destinations state.
 *
 * These tests require a jsdom environment, @testing-library/react, and
 * @testing-library/jest-dom. Written as it.todo(...) stubs to be filled
 * in once the test infrastructure for React component testing is set up.
 *
 * To enable:
 *   npm install -D @testing-library/react @testing-library/jest-dom jsdom
 *   Then add `// @vitest-environment jsdom` at the top of this file.
 *
 * Validates: Requirements 5.7
 */

import { describe, it } from "vitest";

describe("DispatchStockModal — no active franchise destinations", () => {
  it.todo(
    'renders "No active franchises available" as a disabled item within the Franchise Destinations group when franchiseDestinations is an empty array',
    // Render <DispatchStockModal franchiseDestinations={[]} productId="x"
    //   productName="Test" baseUom="KG" />, open the dialog, open the Select,
    // then assert:
    //   - A SelectGroup with label "Franchise Destinations" exists.
    //   - Within that group, a disabled SelectItem with text
    //     "No active franchises available" is rendered.
  );

  it.todo(
    "the selector remains enabled and non-franchise reasons are still selectable when franchiseDestinations is empty",
    // Render <DispatchStockModal franchiseDestinations={[]} productId="x"
    //   productName="Test" baseUom="KG" />, open the dialog, then assert:
    //   - The Select trigger is NOT disabled (aria-disabled is absent or false).
    //   - The "Reasons" SelectGroup still renders DISPATCH_STOCK_REASONS items
    //     (e.g. "Kitchen Consumption", "Customer Sale") and they are selectable.
  );
});
