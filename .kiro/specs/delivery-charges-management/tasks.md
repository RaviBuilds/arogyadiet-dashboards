# Implementation Plan: Delivery Charges Management

## Overview

This plan implements distance-based delivery charges for subscription pricing across all four surfaces (Admin Quick Onboarding, Admin Customer 360 Add Subscription, Customer Checkout, and Master Rate Config Card), introduces a multi-tenant rate configuration store, and consolidates rider payout rate management. The implementation follows the layered architecture: pure calculator → rate service → orchestration service → server actions → UI components.

## Tasks

- [x] 1. Database schema and migrations
  - [x] 1.1 Create `rate_configs` table and seed Core row
    - Create SQL migration script `scripts/create-rate-configs-table.sql`
    - Define the `rate_configs` table with `id`, `scope_type`, `franchise_id`, `delivery_rate_per_km`, `rider_payout_rate_per_km`, `created_at`, `updated_at`
    - Add CHECK constraints for scope_type IN ('CORE_BUSINESS','FRANCHISE'), rate bounds (0 to 999999.99)
    - Add the `rate_configs_scope_shape` CHECK constraint ensuring CORE rows have no franchise_id and FRANCHISE rows must have one
    - Create unique index `uq_rate_configs_core` for exactly one Core row
    - Create unique index `uq_rate_configs_franchise` for at most one row per franchise
    - Insert seed Core row with `delivery_rate_per_km = 13.00` and `rider_payout_rate_per_km` copied from existing `system_settings.rider_payout_per_km` (default 16.00)
    - _Requirements: 1.1, 1.2, 1.7_

  - [x] 1.2 Create `rate_config_audit_logs` table
    - Create SQL migration script `scripts/create-rate-config-audit-logs.sql`
    - Define the `rate_config_audit_logs` table with `id`, `actor_user_id`, `scope_type`, `franchise_id`, `field`, `previous_value`, `new_value`, `created_at`
    - Configure RLS: INSERT allowed for master-authorized sessions, no UPDATE/DELETE policies
    - _Requirements: 12.3, 12.5_

  - [x] 1.3 Alter `payments` table to add `delivery_charge` column
    - Create SQL migration script `scripts/add-delivery-charge-to-payments.sql`
    - Add column `delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0` with CHECK constraint (>= 0 AND <= 999999.99)
    - _Requirements: 6.1, 6.3_

  - [x] 1.4 Alter `subscriptions` table to add `delivery_charge` column
    - Create SQL migration script `scripts/add-delivery-charge-to-subscriptions.sql`
    - Add column `delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0` with CHECK constraint (>= 0 AND <= 999999.99)
    - _Requirements: 6.1_

- [x] 2. Pure delivery charge calculator library
  - [x] 2.1 Implement `src/lib/delivery/deliveryCharge.ts`
    - Export constants: `DEFAULT_DELIVERY_RATE_PER_KM` (13.0), `DEFAULT_RIDER_PAYOUT_RATE_PER_KM` (16.0), `MAX_RATE_PER_KM` (999999.99), `MASTER_CARD_MAX_RATE_PER_KM` (9999.99), `MAX_DELIVERY_CHARGE` (999999.99), `MIN_PLAN_DAYS` (1), `MAX_PLAN_DAYS` (365)
    - Implement `roundHalfUp(value, decimals)` using integer scaling immune to binary-float bias
    - Implement `isValidLat(lat)` and `isValidLng(lng)` range checks
    - Implement `computeDeliveryDistanceKm(address, clinic)` returning `DistanceResult` discriminated union — handles null coords (missing_coordinates), out-of-range (invalid_coordinates), or computes round2(haversine)
    - Implement `calculateDeliveryCharge(input: ChargeInput)` returning `ChargeResult` — validates rate >= 0, distance >= 0, planDays integer 1..365, rejects null/NaN/non-finite; computes perDay = round2(rate × distance), total = round2(perDay × planDays)
    - Implement `calculateTotalPayable(planPrice, totalDeliveryCharge)` returning round2(sum)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.6, 4.8_

  - [ ]* 2.2 Write property tests for `deliveryCharge.ts` — Property 3: Distance equals the rounded Haversine distance
    - **Property 3: Distance equals the rounded Haversine distance**
    - For any address and clinic with non-null coords in valid ranges, `computeDeliveryDistanceKm` returns `round-half-up(calculateHaversineDistanceKm(...), 2)` — non-negative, at most 2 decimal places, no 1.3 multiplier
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 2.3 Write property tests for `deliveryCharge.ts` — Property 4: Missing coordinates yield missing-coordinates outcome
    - **Property 4: Missing coordinates yield a missing-coordinates outcome**
    - For any input where address lat/lng or clinic latitude/longitude is null, returns `missing_coordinates`
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 2.4 Write property tests for `deliveryCharge.ts` — Property 5: Out-of-range coordinates yield invalid-coordinates outcome
    - **Property 5: Out-of-range coordinates yield an invalid-coordinates outcome**
    - For any input where a coordinate is non-null but outside valid range, returns `invalid_coordinates`
    - **Validates: Requirements 3.5**

  - [ ]* 2.5 Write property tests for `deliveryCharge.ts` — Property 6: Delivery charge formula, rounding, clamp, and no tax
    - **Property 6: Delivery charge formula, rounding, clamp, and no tax**
    - For any valid rate, distance, and planDays (1..365), produces correct perDay and total with round-half-up, no tax, both non-negative with ≤ 2 decimals
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 9.2**

  - [ ]* 2.6 Write property tests for `deliveryCharge.ts` — Property 7: Total payable is rounded sum
    - **Property 7: Total payable is the rounded sum of plan price and delivery charge**
    - For any non-negative plan price and delivery charge, returns round-half-up(planPrice + deliveryCharge, 2)
    - **Validates: Requirements 4.6, 5.2, 8.6**

  - [ ]* 2.7 Write property tests for `deliveryCharge.ts` — Property 11: Invalid calculator inputs are rejected
    - **Property 11: Invalid calculator inputs are rejected with no output**
    - For any input where rate < 0, distance < 0, planDays < 1 or non-integer, or any input is null/NaN/non-finite, returns `invalid_input` naming the field
    - **Validates: Requirements 4.8**

  - [ ]* 2.8 Write unit tests for worked examples
    - Test: ₹13 × 10.00 km × 30 = perDay ₹130.00, total ₹3900.00 (Req 4.5)
    - Test: ₹26,250 + ₹3,900 = ₹30,150.00 (Req 4.7)
    - Test `roundHalfUp` boundary cases: 2.675 → 2.68, 2.005 → 2.01, negatives, zero
    - _Requirements: 4.5, 4.7_

- [x] 3. Rate configuration service
  - [x] 3.1 Implement `src/services/RateConfigService.ts`
    - Implement `resolveRatesForClinic(db, clinic)` — franchise → core → default fallback for both delivery and payout rates
    - Implement `resolveDeliveryRateForClinic(db, clinic)` — returns rate and source ("franchise" | "core" | "default")
    - Implement `listRateConfigs(db)` — returns Core rates + per-franchise rates for master card
    - Implement `upsertRate(db, scope, field, value)` — validates bounds (0 to MAX_RATE_PER_KM, ≤ 2 decimals), rejects invalid writes, returns previous value on success
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2_

  - [ ]* 3.2 Write property tests for RateConfigService — Property 1: Rate writes respect store bounds
    - **Property 1: Rate writes respect store bounds and precision**
    - For any candidate value, `upsertRate` accepts iff numeric, ≥ 0, ≤ ₹999,999.99, ≤ 2 decimal places; otherwise rejects and stored value is unchanged
    - Use injected in-memory fake Supabase client
    - **Validates: Requirements 1.7, 1.8**

  - [ ]* 3.3 Write property tests for RateConfigService — Property 2: Rate resolution follows precedence
    - **Property 2: Rate resolution follows franchise → core → default precedence**
    - For any clinic and configuration, resolves to franchise value when set, else Core value when set, else built-in default; Core clinic always gets Core/default
    - Use injected in-memory fake Supabase client
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.4, 11.5, 11.6, 11.7**

- [x] 4. Delivery charge orchestration service
  - [x] 4.1 Implement `src/services/DeliveryChargeService.ts`
    - Implement `computeForCustomer(db, { customerProfileId, planDays })` — loads Primary_Address, runs full pipeline: pincode → clinic → coords → rate → charge
    - Implement `computeForAddress(db, { address, planDays })` — variant when caller already holds address data
    - Return typed `DeliveryChargeOutcome` discriminated union for each failure branch
    - Clamp `totalDeliveryCharge` to [0, MAX_DELIVERY_CHARGE]
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 4.1, 4.2_

  - [ ]* 4.2 Write property tests for DeliveryChargeService — Property 10: Unresolvable clinic/missing pincode
    - **Property 10: Unresolvable clinic or missing pincode yields a typed no-charge outcome**
    - For any customer with null/empty/whitespace pincode, returns `missing_pincode` without calling clinic resolver; for unresolved pincodes returns `unresolved_clinic` naming the resolution type
    - Use injected in-memory fake Supabase client
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 4.3 Write unit tests for each pipeline failure branch
    - Test `missing_pincode`, `unresolved_clinic` (none), `unresolved_clinic` (ambiguous), `missing_coordinates`, `invalid_coordinates`, `unresolved_rate`
    - _Requirements: 2.5, 2.6, 3.3, 3.4, 3.5, 2.7_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Server actions for delivery charge calculation
  - [x] 6.1 Implement `src/actions/admin-actions/deliveryChargeActions.ts`
    - Create `calculateDeliveryChargeAction` server action gated by admin authorization (`checkGroupManage("customers")`)
    - Accept `{ customerProfileId, planDays }`, call `DeliveryChargeService.computeForCustomer`
    - Return full `DeliveryChargeOutcome` so UI can display distance/rate note or failure message
    - _Requirements: 7.2, 8.1, 8.2_

  - [x] 6.2 Implement `src/actions/master-actions/rateConfigActions.ts`
    - Create `getRateConfigsAction` gated by master portal authorization — calls `RateConfigService.listRateConfigs`
    - Create `upsertRateAction` gated by master portal authorization — validates against MASTER_CARD_MAX_RATE_PER_KM (₹9,999.99), calls `RateConfigService.upsertRate`, writes `rate_config_audit_logs` row, calls `revalidatePath("/master/system")`
    - _Requirements: 10.6, 10.7, 10.8, 10.9, 12.1, 12.2, 12.3_

  - [ ]* 6.3 Write property test — Property 9: Master card rate validation
    - **Property 9: Master card rate validation**
    - For any rate entered, accepted iff numeric, within [₹0.00, ₹9,999.99], ≤ 2 decimals; otherwise rejected with field-specific message
    - **Validates: Requirements 10.7, 10.8**

- [x] 7. Customer checkout integration
  - [x] 7.1 Modify `src/actions/checkoutActions.ts` for server-side delivery charge
    - In `createRazorpayOrderAction`: compute `totalDeliveryCharge` server-side via `DeliveryChargeService.computeForCustomer`, add to order amount
    - In `verifyAndActivateSubscriptionAction`: recompute delivery charge server-side, reject any client-supplied value that differs, persist to `payments.delivery_charge` and `subscriptions.delivery_charge`
    - Set `payments.amount` = Total_Payable (plan + delivery)
    - If outcome is failure, refuse order creation with typed reason
    - _Requirements: 9.1, 9.5, 9.6, 9.7, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.2 Update customer checkout UI `step-5-preview.tsx`
    - Replace hard-coded "Delivery … Free" with computed `Total_Delivery_Charge` in price details
    - Display Total amount as Total_Payable (including delivery)
    - On failure outcome, show message identifying condition (unresolved clinic / missing coordinates), disable "Proceed to Pay", retain entered data
    - No manual override control (Req 5.5)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7, 5.5_

  - [ ]* 7.3 Write property test — Property 12: Checkout uses server-computed charge authoritatively
    - **Property 12: Checkout uses the server-computed charge authoritatively**
    - For any client-supplied delivery charge differing from server-computed value, order creation is rejected
    - **Validates: Requirements 9.6**

- [x] 8. Admin Quick Onboarding integration
  - [x] 8.1 Modify `QuickOnboardingForm.tsx` Payment & Review step
    - Add "Calculate Delivery Charges" button that calls `calculateDeliveryChargeAction` with selected plan's `durationDays`
    - Add editable `deliveryCharge` numeric field (0.00 to 999,999.99, ≤ 2 decimals)
    - Display distance/rate note on successful calculation (distance km + rate per km)
    - Compute Total_Payable = plan amount + delivery charge; use as amount marked paid
    - On failure, show reason message (unresolved clinic / missing coordinates), leave field empty and editable
    - Validate manual entry: reject non-numeric, negative, > 999,999.99, > 2 decimal places
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 8.2 Wire delivery charge into onboarding persistence
    - Pass delivery charge through onboarding payload → `OnboardingService` → `onboard_customer` RPC
    - Persist to `payments.delivery_charge` and `subscriptions.delivery_charge`
    - Log admin override audit entry via `logAdminAction` when admin edits auto-calculated value
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 12.4_

  - [ ]* 8.3 Write property test — Property 8: Admin override validation
    - **Property 8: Admin override validation**
    - For any admin-entered delivery charge, accepted iff numeric, ≥ 0, ≤ ₹999,999.99, ≤ 2 decimals; otherwise rejected and previous charge/Total_Payable retained
    - **Validates: Requirements 5.1, 5.4, 7.7, 8.7**

- [x] 9. Admin Customer 360 Add Subscription integration
  - [x] 9.1 Modify `AdminAddSubscriptionForm.tsx`
    - Add "Calculate Delivery Charges" control in both Existing_Plan and Custom_Plan modes
    - Existing_Plan mode: use `selectedPlan.duration_days` as planDays
    - Custom_Plan mode: use admin-entered duration (1..999) as planDays
    - Add editable `deliveryCharge` field (0.00 to 999,999,999.99, ≤ 2 decimals)
    - Display distance/rate note on success
    - Recompute Total_Payable whenever delivery charge is edited
    - On failure, show message (unresolved clinic / missing coordinates), allow manual entry
    - Validate: reject non-numeric, negative, > 999,999,999.99
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 9.2 Wire delivery charge into `addSubscription` persistence
    - Pass delivery charge through to `addSubscription` in `adminSubscriptionActions.ts`
    - Persist to `payments.delivery_charge` and `subscriptions.delivery_charge`
    - Set `payments.amount` = plan amount + delivery charge
    - Log admin override audit entry when admin edits auto-calculated value
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 12.4_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Master rate configuration card
  - [x] 11.1 Create `src/shared/components/master/rates/RateConfigCard.tsx`
    - Client component rendered on `master/(main)/system/page.tsx`
    - Display Core delivery rate and payout rate fields (INR per km, 2 decimal places)
    - Display per-franchise table with delivery rate and payout rate for each franchise
    - Each field is an editable input with inline validation (numeric, 0.00 to 9,999.99, ≤ 2 decimals)
    - Save button per field calls `upsertRateAction`; show success toast within 3 seconds
    - Show validation error messages identifying invalid field and accepted range
    - On persistence failure, show error message and retain previous value
    - No charge/payout calculations on this card (Req 10.10)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_

  - [x] 11.2 Register `RateConfigCard` on master system page
    - Import and render `RateConfigCard` in `src/app/master/(main)/system/page.tsx`
    - Ensure master authorization check is applied
    - _Requirements: 10.1, 12.1, 12.2_

- [x] 12. Legacy rider payout consolidation
  - [x] 12.1 Remove rider-payout-per-km input from `SettingsTab.tsx`
    - Remove the payout-per-km input control from `src/shared/components/admin/finance/SettingsTab.tsx`
    - Ensure `updateSystemSettings` ignores any `rider_payout_per_km` in submission
    - _Requirements: 11.1, 11.2_

  - [x] 12.2 Update rider dispatch to use `RateConfigService`
    - Modify `src/actions/system-actions/routeEngine.ts` dispatch logic
    - Replace `system_settings.rider_payout_per_km` read with `RateConfigService.resolveRatesForClinic` for the delivery's clinic
    - Core clinic → Core payout rate; Franchise clinic → franchise payout rate with fallback to Core
    - Keep existing Haversine × 1.3 road distance formula unchanged
    - On rate read timeout (> 5s) or unresolved franchise, use default ₹16.00 and record indication
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ]* 12.3 Write property test — Property 13: Legacy payout submission is a no-op
    - **Property 13: Legacy payout submission is a no-op for the stored rate**
    - For any value submitted through legacy `updateSystemSettings` for `rider_payout_per_km`, the Core rate in Rate_Config_Store is unchanged
    - **Validates: Requirements 11.2**

  - [ ]* 12.4 Write property test — Property 14: Rider payout uses resolved rate over road distance
    - **Property 14: Rider payout uses the resolved rate over the road distance**
    - For any coordinates and resolved rate, payout = round-half-up(resolvedRate × (Haversine × 1.3), 2)
    - **Validates: Requirements 11.8**

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check` with ≥ 100 iterations
- Unit tests validate specific examples and edge cases
- The pure calculator (`deliveryCharge.ts`) is implemented first as it has no dependencies and is the foundation for all other layers
- Server actions reuse `DeliveryChargeService` to guarantee consistent calculation across all surfaces
- The customer checkout always recomputes server-side to prevent client tampering

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1", "8.1", "9.1", "11.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "8.2", "9.2", "11.2", "12.1", "12.2"] },
    { "id": 7, "tasks": ["8.3", "12.3", "12.4"] }
  ]
}
```
