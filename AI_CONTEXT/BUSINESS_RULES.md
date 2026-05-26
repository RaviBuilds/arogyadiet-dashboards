# Core Business Rules

## 1. The Pincode Architecture (Migration context)
- The system previously used a Zone-based system and has migrated to a **Pincode-based** service area architecture (`rider_service_areas`).
- Riders are assigned to specific pincodes.
- **NEVER** attempt to reintroduce "Zone" entities or logic into routing.

## 2. Subscription Lifecycle & Pausing
- A subscription has a `total_days` count and `pause_credits`.
- **Pausing a day:** When a customer pauses a delivery day (`is_paused: true`), the system pushes the `effective_end_on` date out by 1 day.
- **Unpausing a day:** Recalculates and pulls the end date closer.
- The `subscriptions.pause_credits_used` must always perfectly match the count of `is_paused = true` in `subscription_daily_preferences` for that subscription.

## 3. Daily Deliveries & Routing
- Deliveries are processed daily via cron or admin dispatch.
- **Rider Assignment:** Handled via Haversine distance calculations from the main `kitchens` coordinates to the customer's `addresses`.
- **Payout:** Payouts are generated based on a system-wide setting `rider_payout_per_km` multiplied by the estimated road distance (Haversine distance * 1.3).
- **Routing Sequence:** Orders in a `delivery_batch` are ordered via `route_sequence`.

## 4. Admin Permissions
- Operations must only be available to users with the `ADMIN` role.
- Any action that modifies payouts, routing, or system-wide settings MUST log the event or be highly restricted via middleware.

## 5. Stable Modules
- **Customer & Rider Portals are stable and in production.**
- Avoid massive refactors to `customer` and `rider` components without explicit user authorization, as regressions here impact live users immediately.
