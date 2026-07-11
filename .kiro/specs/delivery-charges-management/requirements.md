# Requirements Document

## Introduction

This feature introduces **distance-based delivery charges** for meal subscription customers on the ArogyaDiet platform. Today, subscription pricing is plan price only and delivery is shown as "Free". This feature adds a delivery charge that is calculated from the road-map-independent distance between the customer's primary delivery address and the clinic that serves the customer's pincode, multiplied by a configurable per-kilometer rate and by the number of plan days.

The feature spans four surfaces where a subscription amount is determined:

1. Admin **Quick Onboarding** (`admin.localhost:3000/customers/quick-onboard`) — Payment & Review step.
2. Admin **Customer 360 → Add Subscription** tab (`AdminAddSubscriptionForm`) — both "Existing Plan" and "Custom Plan" modes.
3. Customer **Subscription Checkout** (`customer.arogyadiet.com/subscription/checkout`) — Review/price-details step.
4. Master **System & Configuration** page (`master.localhost:3000/system`) — a new card to manage per-km delivery rates and per-km rider payout rates for the Core Business and per Franchise.

The feature also consolidates rider-payout-per-km management. A rider payout per-km rate is currently editable in the admin Finance "Settings" tab (`SettingsTab`), backed by the single-row `system_settings.rider_payout_per_km`. That editor is being replaced by the new master card, which manages the rate for the Core Business plus per-Franchise overrides.

This document is written to be precise enough for a downstream implementer with no additional context. It grounds all behavior in the existing database schema and code (see Glossary for concrete tables, columns, and functions).

### Assumptions and Decisions to Confirm

The following decisions were made to produce a complete initial draft. They are called out explicitly because they materially affect behavior and should be confirmed during review.

- **D1 — Distance basis.** The worked example provided (10 km → ₹13 × 10 = ₹130/day) uses the distance value directly with no road-distance multiplier. Therefore delivery charge distance is defined as the **straight-line Haversine distance** (`calculateHaversineDistanceKm`) between the primary address and the clinic, **without** the `1.3` road multiplier. This deliberately differs from rider payout, which continues to use `estimateRoadDistanceKm` (Haversine × 1.3). Confirm whether delivery charge should instead also apply the 1.3 multiplier.
- **D2 — Rounding.** Distance is rounded to 2 decimal places. The per-day charge and the total delivery charge are each rounded to 2 decimal places (INR). Confirm if rounding to the nearest whole rupee is preferred.
- **D3 — Marketing copy.** Static marketing bullets that read "Free Delivery across Hyderabad" (in `plan-card.tsx` and plan feature lists) are out of scope for this feature and will be left unchanged unless confirmed otherwise.
- **D4 — Scope of onboarding surfaces.** Only the **admin** Quick Onboarding wizard is in scope. A parallel franchise-portal quick-onboard exists (`src/app/franchise/(main)/customers/quick-onboard`) and is out of scope unless confirmed otherwise.
- **D5 — Existing subscriptions.** Delivery charges apply only to subscriptions created after this feature is deployed. No back-charging of active/historical subscriptions.

## Glossary

- **Core_Business**: The `businesses` row with `type = 'Core'` (seeded as "Core Hyderabad Business"). Owns Core_Clinics (clinics whose `franchise_id` is null).
- **Franchise**: A `franchises` row. Owns Franchise_Clinics (clinics whose `franchise_id` equals the franchise id).
- **Clinic**: A `clinics` row. Holds `latitude` and `longitude` (double precision), `kitchen_id`, and a nullable `franchise_id`. A Clinic with `franchise_id = null` belongs to the Core_Business.
- **Primary_Address**: The `addresses` row for a customer where `is_primary = true`. Holds `pincode`, `lat`, and `lng` (numeric).
- **Clinic_Resolver**: The existing function `resolveClinicForPincode(pincode)` in `src/lib/clinic/pincode-resolver.ts`, which returns `{ type: 'resolved', clinic_id }`, `{ type: 'none' }`, or `{ type: 'ambiguous' }` based on `rider_service_areas`.
- **Distance_Function**: The existing `calculateHaversineDistanceKm(lat1, lng1, lat2, lng2)` in `src/lib/distance.ts`, returning straight-line kilometers.
- **Delivery_Rate**: The per-kilometer amount (INR/km) used to compute delivery charges. Default ₹13.00/km.
- **Rider_Payout_Rate**: The per-kilometer amount (INR/km) used to compute rider payouts. Default ₹16.00/km. Currently stored in `system_settings.rider_payout_per_km`.
- **Rate_Scope**: Either "Core_Business" (one rate applying to all Core_Clinics) or a specific "Franchise" (one rate applying to all that Franchise's Clinics).
- **Rate_Resolver**: The component that, given a Clinic, returns the applicable Delivery_Rate and Rider_Payout_Rate by scope.
- **Rate_Config_Store**: The persistent storage of Delivery_Rate and Rider_Payout_Rate values by Rate_Scope.
- **Delivery_Charge_Calculator**: The component that computes the per-day and total delivery charge.
- **Total_Plan_Days**: The number of delivery days for the subscription being priced (`subscription_plans.duration_days` for a plan, or the admin-entered duration for a Custom_Plan).
- **Per_Day_Delivery_Charge**: `Delivery_Rate × Distance_km`.
- **Total_Delivery_Charge**: `Per_Day_Delivery_Charge × Total_Plan_Days`.
- **Plan_Price**: The tax-inclusive subscription price (`subscription_plans.price`, or the admin-entered total for a Custom_Plan).
- **Total_Payable**: `Plan_Price + Total_Delivery_Charge`.
- **Quick_Onboarding_Form**: The admin wizard client component `QuickOnboardingForm` used at `admin/customers/quick-onboard`; the delivery-charge action is added to its final Payment & Review step.
- **Admin_Add_Subscription_Form**: The component `AdminAddSubscriptionForm` in the Customer 360 "Add Subscription" tab, supporting Existing_Plan and Custom_Plan modes.
- **Customer_Checkout**: The customer subscription checkout wizard, whose Review step is `step-5-preview.tsx`, backed by `checkoutActions.ts`.
- **Master_Rate_Config_Card**: The new card on the master `System & Configuration` page for managing Delivery_Rate and Rider_Payout_Rate values.
- **Legacy_Payout_Editor**: The rider-payout-per-km editor currently rendered by `SettingsTab` in `src/shared/components/admin/finance/SettingsTab.tsx`.

## Requirements

### Requirement 1: Rate configuration data model and defaults

**User Story:** As a Master Admin, I want per-km delivery and rider-payout rates stored per Core_Business and per Franchise, so that charges and payouts can be configured across the multi-tenant hierarchy.

#### Acceptance Criteria

1. THE Rate_Config_Store SHALL persist exactly one Delivery_Rate and exactly one Rider_Payout_Rate for the Core_Business Rate_Scope.
2. THE Rate_Config_Store SHALL persist at most one Delivery_Rate and at most one Rider_Payout_Rate for each Franchise Rate_Scope.
3. WHERE no Delivery_Rate has been configured for the Core_Business Rate_Scope, THE Rate_Resolver SHALL return a Delivery_Rate of ₹13.00 per kilometer.
4. WHERE no Rider_Payout_Rate has been configured for the Core_Business Rate_Scope, THE Rate_Resolver SHALL return a Rider_Payout_Rate of ₹16.00 per kilometer.
5. WHERE no Delivery_Rate has been configured for a specific Franchise Rate_Scope, THE Rate_Resolver SHALL return the effective Core_Business Delivery_Rate for Clinics of that Franchise.
6. WHERE no Rider_Payout_Rate has been configured for a specific Franchise Rate_Scope, THE Rate_Resolver SHALL return the effective Core_Business Rider_Payout_Rate for Clinics of that Franchise.
7. THE Rate_Config_Store SHALL store each rate as a numeric value between ₹0.00 and ₹999,999.99 inclusive, with at most 2 decimal places, expressed in INR per kilometer.
8. IF a request to write a Delivery_Rate or Rider_Payout_Rate specifies a value that is negative, exceeds ₹999,999.99, or has more than 2 decimal places, THEN THE Rate_Config_Store SHALL reject the write, retain the previously stored value, and return an error indicating the rate is outside the permitted range.

### Requirement 2: Resolving the applicable rate for a customer

**User Story:** As the pricing system, I want to determine which per-km rate applies to a given customer, so that the correct amount is calculated.

#### Acceptance Criteria

1. WHEN a rate is requested for a Clinic whose `franchise_id` is null, THE Rate_Resolver SHALL return the Core_Business Rate_Scope rate.
2. WHEN a rate is requested for a Clinic whose `franchise_id` is set, THE Rate_Resolver SHALL return the rate configured for that Franchise Rate_Scope, applying the fallback rules in Requirement 1.5 and 1.6.
3. WHEN the applicable Clinic for a customer is required AND the customer's Primary_Address `pincode` is a non-null, non-empty value, THE Rate_Resolver SHALL obtain the Clinic by passing that `pincode` to the Clinic_Resolver.
4. IF the Clinic_Resolver returns `type = 'resolved'`, THEN THE Rate_Resolver SHALL use the returned `clinic_id` to select the Rate_Scope and SHALL return exactly one rate value.
5. IF the Clinic_Resolver returns `type = 'none'` or `type = 'ambiguous'`, THEN THE Rate_Resolver SHALL report an unresolved-clinic outcome that identifies the returned `type` value, SHALL NOT return a delivery charge amount, and SHALL leave any existing charge amount unchanged.
6. IF the customer has no Primary_Address, or the Primary_Address `pincode` is null or empty, THEN THE Rate_Resolver SHALL report an unresolved-clinic outcome indicating a missing pincode, SHALL NOT call the Clinic_Resolver, and SHALL NOT return a delivery charge amount.
7. IF the selected Rate_Scope has no configured rate after the Requirement 1.5 and 1.6 fallback rules are applied, THEN THE Rate_Resolver SHALL report an unresolved-rate outcome and SHALL NOT return a delivery charge amount.

### Requirement 3: Delivery charge distance calculation

**User Story:** As the pricing system, I want to compute the distance between the customer's primary address and the serving clinic, so that a distance-based charge can be derived.

#### Acceptance Criteria

1. WHEN a delivery distance is required AND the Primary_Address (`lat`, `lng`) and resolved Clinic (`latitude`, `longitude`) each contain non-null coordinates within valid ranges (latitude -90.0 to 90.0 inclusive, longitude -180.0 to 180.0 inclusive), THE Delivery_Charge_Calculator SHALL compute the straight-line distance in kilometers between the Primary_Address and the resolved Clinic using the Distance_Function.
2. WHEN the straight-line distance has been computed, THE Delivery_Charge_Calculator SHALL round the computed distance to exactly 2 decimal places using round-half-up before applying the rate.
3. IF the Primary_Address `lat` or `lng` is null, THEN THE Delivery_Charge_Calculator SHALL report a missing-coordinates outcome, SHALL NOT return a delivery charge amount, and SHALL leave any existing charge value unchanged.
4. IF the resolved Clinic `latitude` or `longitude` is null, THEN THE Delivery_Charge_Calculator SHALL report a missing-coordinates outcome, SHALL NOT return a delivery charge amount, and SHALL leave any existing charge value unchanged.
5. IF any of the Primary_Address `lat`/`lng` or resolved Clinic `latitude`/`longitude` values are non-null but fall outside the valid ranges (latitude -90.0 to 90.0 inclusive, longitude -180.0 to 180.0 inclusive), THEN THE Delivery_Charge_Calculator SHALL report an invalid-coordinates outcome and SHALL NOT return a delivery charge amount.

### Requirement 4: Delivery charge amount calculation

**User Story:** As a customer or admin, I want the delivery charge computed from distance, rate, and plan days, so that the total payable is accurate.

#### Acceptance Criteria

1. THE Delivery_Charge_Calculator SHALL compute Per_Day_Delivery_Charge as Delivery_Rate multiplied by the distance in kilometers, where the distance is first rounded to 2 decimal places using round-half-up.
2. THE Delivery_Charge_Calculator SHALL compute Total_Delivery_Charge as Per_Day_Delivery_Charge multiplied by Total_Plan_Days, where Total_Plan_Days is a whole number between 1 and 365 inclusive.
3. THE Delivery_Charge_Calculator SHALL round Per_Day_Delivery_Charge and Total_Delivery_Charge to 2 decimal places using round-half-up.
4. THE Delivery_Charge_Calculator SHALL NOT apply any tax to Per_Day_Delivery_Charge or Total_Delivery_Charge.
5. WHEN Delivery_Rate is ₹13.00, distance is 10.00 km, and Total_Plan_Days is 30, THE Delivery_Charge_Calculator SHALL produce Per_Day_Delivery_Charge = ₹130.00 and Total_Delivery_Charge = ₹3900.00.
6. THE Delivery_Charge_Calculator SHALL compute Total_Payable as Plan_Price plus Total_Delivery_Charge, rounded to 2 decimal places using round-half-up.
7. WHEN Plan_Price is ₹26,250.00 and Total_Delivery_Charge is ₹3900.00, THE Delivery_Charge_Calculator SHALL produce Total_Payable = ₹30,150.00.
8. IF Delivery_Rate is less than ₹0.00, distance is less than 0.00 km, Total_Plan_Days is less than 1, or any of these inputs is null or non-numeric, THEN THE Delivery_Charge_Calculator SHALL reject the calculation, return a validation error indicating the invalid input, and produce no Per_Day_Delivery_Charge, Total_Delivery_Charge, or Total_Payable value.

### Requirement 5: Admin manual override of the delivery charge

**User Story:** As an admin, I want to manually change the auto-calculated delivery charge, so that I can handle exceptions.

#### Acceptance Criteria

1. WHERE a delivery charge has been auto-calculated in an admin surface, THE admin surface SHALL allow the admin to enter a delivery charge amount that is a numeric value from 0.00 to 999,999.99 inclusive with at most 2 decimal places.
2. WHEN the admin confirms an edited delivery charge amount, THE admin surface SHALL recompute Total_Payable as Plan_Price plus the admin-entered delivery charge.
3. WHEN the admin confirms an edited delivery charge amount, THE admin surface SHALL persist the admin-entered amount as the delivery charge for that subscription in place of the auto-calculated amount.
4. IF the admin enters a delivery charge value that is non-numeric, negative, greater than 999,999.99, or has more than 2 decimal places, THEN THE admin surface SHALL reject the entry, display an error indication identifying the invalid value, retain the previously accepted delivery charge amount, and leave Total_Payable unchanged.
5. THE Customer_Checkout SHALL NOT expose a manual override of the delivery charge to the customer.

### Requirement 6: Persisting the delivery charge

**User Story:** As the finance system, I want the delivery charge recorded against the subscription and its payment, so that invoices and totals are auditable.

#### Acceptance Criteria

1. WHEN a subscription is created through any in-scope surface with a delivery charge, THE System SHALL store the Total_Delivery_Charge, rounded to 2 decimal places and within 0.00 to 999,999.99 inclusive, associated with that subscription.
2. WHEN a payment is recorded for a subscription that includes a delivery charge, THE System SHALL record a payment `amount` equal to Total_Payable, rounded to 2 decimal places.
3. THE System SHALL store the delivery charge as a distinct value separate from `base_amount`, `tax_amount`, and `discount_amount` on the payment record.
4. THE System SHALL record a delivery `tax_amount` of ₹0.00 for the delivery-charge portion of any payment.
5. IF the System fails to persist the Total_Delivery_Charge or the payment `amount`, THEN THE System SHALL NOT create the subscription or payment record and SHALL return an error indicating the persistence failure.

### Requirement 7: Admin Quick Onboarding integration

**User Story:** As an admin onboarding a customer, I want to calculate and include the delivery charge on the Payment & Review step, so that the amount marked as paid is correct.

#### Acceptance Criteria

1. THE Quick_Onboarding_Form SHALL display a "Calculate Delivery Charges" control on its final Payment & Review step.
2. WHEN the admin activates the "Calculate Delivery Charges" control, THE Quick_Onboarding_Form SHALL compute the delivery charge as the resolved distance in kilometers multiplied by the resolved Delivery_Rate multiplied by the selected plan's Total_Plan_Days, rounded to 2 decimal places and constrained to 0.00 to 999,999.99 inclusive, within 3 seconds, and SHALL auto-fill the delivery charge field with the result.
3. WHEN the delivery charge is auto-filled, THE Quick_Onboarding_Form SHALL display a note stating the distance used in kilometers rounded to 2 decimal places and the numeric Delivery_Rate applied per kilometer.
4. WHEN a delivery charge is present, THE Quick_Onboarding_Form SHALL set the Total_Payable to the sum of the plan amount and the delivery charge and SHALL include that Total_Payable as the amount the admin marks as paid.
5. IF the delivery charge cannot be calculated due to an unresolved clinic or missing coordinates, THEN THE Quick_Onboarding_Form SHALL display a message identifying whether the cause is an unresolved clinic or missing coordinates, SHALL retain the entered onboarding data, and SHALL present an empty, editable delivery charge field for manual entry.
6. THE Quick_Onboarding_Form SHALL provide an editable delivery charge field that accepts a numeric value from 0.00 to 999,999.99 inclusive with at most 2 decimal places, and SHALL allow the admin to edit the auto-filled delivery charge before marking payment done.
7. IF the admin enters a delivery charge that is non-numeric, negative, greater than 999,999.99, or has more than 2 decimal places, THEN THE Quick_Onboarding_Form SHALL reject the entry, display a message indicating the value is invalid, and exclude the rejected value from the Total_Payable.

### Requirement 8: Admin Customer 360 Add Subscription integration

**User Story:** As an admin adding a subscription in Customer 360, I want to calculate delivery charges for both existing and custom plans, so that the total payable includes delivery.

#### Acceptance Criteria

1. WHERE the Admin_Add_Subscription_Form is in Existing_Plan mode, THE Admin_Add_Subscription_Form SHALL provide a control that, when activated, calculates the delivery charge using the selected plan's Total_Plan_Days as the plan duration input.
2. WHERE the Admin_Add_Subscription_Form is in Custom_Plan mode, THE Admin_Add_Subscription_Form SHALL provide a control that, when activated, calculates the delivery charge using the admin-entered plan duration (an integer from 1 to 999 days) as Total_Plan_Days.
3. WHEN the delivery charge is calculated in either mode, THE Admin_Add_Subscription_Form SHALL set the Total_Payable to the sum of the plan amount and the calculated delivery charge, expressed as a non-negative currency value from 0.00 to 999,999,999.99 rounded to 2 decimal places, and SHALL display the updated Total_Payable.
4. WHEN the delivery charge is calculated, THE Admin_Add_Subscription_Form SHALL display the distance used in kilometers rounded to 2 decimal places and the Delivery_Rate applied per kilometer.
5. THE Admin_Add_Subscription_Form SHALL provide an editable delivery charge field that accepts a non-negative currency value from 0.00 to 999,999,999.99 rounded to 2 decimal places, and SHALL allow the admin to edit this field before recording the subscription, including when no calculation has occurred and when a calculation has failed and no charge exists.
6. WHEN the admin edits the delivery charge field, THE Admin_Add_Subscription_Form SHALL recompute the Total_Payable as the sum of the plan amount and the edited delivery charge.
7. IF the admin enters a delivery charge that is non-numeric, negative, or outside the range 0.00 to 999,999,999.99, THEN THE Admin_Add_Subscription_Form SHALL reject the entry, display a message indicating the value is invalid, and retain the previous delivery charge and Total_Payable.
8. IF the delivery charge cannot be calculated due to an unresolved clinic or missing coordinates, THEN THE Admin_Add_Subscription_Form SHALL display a message identifying whether the cause is an unresolved clinic or missing coordinates, SHALL leave the Total_Payable unchanged, and SHALL allow manual entry of the delivery charge.

### Requirement 9: Customer subscription checkout integration

**User Story:** As a customer purchasing a subscription, I want to see the delivery charge in the price details and total, so that I pay the correct amount.

#### Acceptance Criteria

1. WHEN the customer reaches the Customer_Checkout Review step, THE Customer_Checkout SHALL compute the Total_Delivery_Charge using the customer's Primary_Address, the resolved Clinic, the resolved Delivery_Rate, and the selected plan's Total_Plan_Days, and SHALL complete the computation within 3 seconds.
2. THE Customer_Checkout SHALL round the computed Total_Delivery_Charge to 2 decimal places and SHALL constrain it to a value between 0.00 and 999,999.99 inclusive.
3. WHEN the Customer_Checkout Review step is displayed, THE Customer_Checkout SHALL display the computed Total_Delivery_Charge in the price-details section in place of the current "Free" delivery label.
4. WHEN the Customer_Checkout Review step is displayed, THE Customer_Checkout SHALL display a Total amount equal to Total_Payable, where Total_Payable includes the Total_Delivery_Charge.
5. WHEN the customer completes payment, THE Customer_Checkout SHALL create the payment order for an amount equal to Total_Payable, rounded to 2 decimal places.
6. THE Customer_Checkout SHALL compute the Total_Delivery_Charge server-side when creating the payment order, and SHALL reject any client-supplied delivery charge value that differs from the server-computed Total_Delivery_Charge.
7. IF the Total_Delivery_Charge cannot be calculated because the Clinic is unresolved or the Primary_Address coordinates are missing, THEN THE Customer_Checkout SHALL display a message identifying which condition (unresolved clinic or missing coordinates) caused the failure, SHALL disable completion of payment, and SHALL retain the entered checkout data until a delivery address with a resolvable Clinic and valid coordinates is provided.

### Requirement 10: Master rate management card

**User Story:** As a Master Admin, I want a single card to manage delivery and rider-payout per-km rates for the Core Business and each franchise, so that all per-km rates are configured in one place.

#### Acceptance Criteria

1. THE Master_Rate_Config_Card SHALL appear on the master `System & Configuration` page.
2. THE Master_Rate_Config_Card SHALL display and allow editing of the Core_Business Delivery_Rate as a value in Indian Rupees per kilometer with exactly two decimal places.
3. THE Master_Rate_Config_Card SHALL display and allow editing of the Core_Business Rider_Payout_Rate as a value in Indian Rupees per kilometer with exactly two decimal places.
4. THE Master_Rate_Config_Card SHALL display and allow editing of a Delivery_Rate for each Franchise as a value in Indian Rupees per kilometer with exactly two decimal places.
5. THE Master_Rate_Config_Card SHALL display and allow editing of a Rider_Payout_Rate for each Franchise as a value in Indian Rupees per kilometer with exactly two decimal places.
6. WHEN a Master Admin saves a rate that passes validation, THE Master_Rate_Config_Card SHALL persist the value to the Rate_Config_Store for the corresponding Rate_Scope and SHALL display a confirmation indicating the save succeeded within 3 seconds.
7. IF a Master Admin enters a rate that is non-numeric, negative, greater than ₹9,999.99 per kilometer, or has more than two decimal places, THEN THE Master_Rate_Config_Card SHALL reject the value, SHALL display a validation message identifying the invalid field and the accepted range, and SHALL NOT persist the rejected value.
8. THE Master_Rate_Config_Card SHALL accept any rate from ₹0.00 to ₹9,999.99 per kilometer inclusive, with two decimal places, as a valid value.
9. IF persistence of a rate to the Rate_Config_Store fails, THEN THE Master_Rate_Config_Card SHALL display an error message indicating the save did not complete and SHALL retain the previously stored value for that Rate_Scope.
10. THE Master_Rate_Config_Card SHALL manage only per-km Delivery_Rate and Rider_Payout_Rate values and SHALL NOT perform delivery charge or payout total calculations.

### Requirement 11: Consolidating rider payout rate management

**User Story:** As a Master Admin, I want the old rider-payout-per-km editor removed, so that rider payout rates are managed only through the new card.

#### Acceptance Criteria

1. THE System SHALL exclude the Legacy_Payout_Editor's rider-payout-per-km input from all rendered views such that no editable control for the rider-payout-per-km value is present on that surface.
2. WHEN the Legacy_Payout_Editor is submitted, THE System SHALL disregard any rider-payout-per-km value contained in that submission and leave the Core_Business Rider_Payout_Rate in the Rate_Config_Store unchanged.
3. WHEN a value for `system_settings.rider_payout_per_km` was previously read, THE System SHALL instead read the Core_Business Rider_Payout_Rate from the Rate_Config_Store as the source of the rider payout rate.
4. IF the Rate_Config_Store does not return a Core_Business Rider_Payout_Rate within 5 seconds of a required read, THEN THE System SHALL use the default Rider_Payout_Rate of ₹16.00 per kilometer and record an indication that the default rate was applied.
5. WHEN a rider payout is calculated for a delivery served by a Franchise Clinic, THE System SHALL use the Rider_Payout_Rate resolved for that Franchise by the Rate_Resolver.
6. IF the Rate_Resolver cannot resolve a Rider_Payout_Rate for the Franchise, THEN THE System SHALL use the Core_Business Rider_Payout_Rate and record an indication that the Franchise-specific rate could not be resolved.
7. WHEN a rider payout is calculated for a delivery served by a Core_Clinic, THE System SHALL use the Core_Business Rider_Payout_Rate.
8. THE System SHALL calculate the rider payout as the resolved per-km Rider_Payout_Rate multiplied by the estimated road distance, where the estimated road distance equals the Haversine distance multiplied by 1.3, changing only the source and scoping of the per-km rate.

### Requirement 12: Access control and audit

**User Story:** As the platform owner, I want rate changes restricted and recorded, so that only authorized master admins can alter pricing inputs.

#### Acceptance Criteria

1. WHILE a user session is authenticated with master portal authorization, THE System SHALL grant that user read and write access to the Master_Rate_Config_Card.
2. IF a user without master portal authorization requests access to the Master_Rate_Config_Card, THEN THE System SHALL deny access, withhold all rate configuration data, and return a response indicating the access is unauthorized.
3. WHEN a rate value is created or updated in the Master_Rate_Config_Card, THE System SHALL record an audit entry containing the acting user identifier, the previous rate value, the new rate value, and a timestamp accurate to the second.
4. WHEN an admin manually overrides a delivery charge during onboarding or subscription creation, THE System SHALL record an audit entry containing the overriding user identifier, the system-calculated amount, the overridden amount, and a timestamp accurate to the second.
5. THE System SHALL retain every audit entry as read-only and SHALL reject any request to modify or delete a recorded audit entry.
