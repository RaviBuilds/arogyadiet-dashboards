# Database Rules & Relationships

## Critical Tables
1. **`users`**: Extends `auth.users`. Defines system-wide user profiles and roles.
2. **`customer_profiles` & `rider_profiles`**: Specialized sub-profiles linking back to `users`. These hold portal-specific data (e.g., dietary preferences, rider employee codes).
3. **`subscriptions`**: The core revenue object. Tracks plan, duration, and pause credits.
4. **`subscription_daily_preferences`**: A calendar representation of a subscription. Every day of a subscription has a row here tracking the meal category, delivery address, or pause status for that specific day.
5. **`delivery_orders`**: The daily execution object. Generated based on daily preferences. Assigned to a rider.
6. **`delivery_batches`**: A grouping of delivery orders assigned to a single rider for a specific day.

## Critical Relationships
- A `User` has one `Customer Profile` OR one `Rider Profile` (based on role).
- A `Customer Profile` has many `Subscriptions`.
- A `Subscription` has many `Subscription Daily Preferences`.
- A `Delivery Order` belongs to a `Customer Profile` and is assigned to a `Rider Profile`.

## Dangerous Operations
- ⚠️ **Mutating `subscription_daily_preferences` directly:** This table must be mutated via the specific bulk actions (e.g., `bulkUpdatePausePreferencesAction`) which recount pause credits and sync the `subscriptions` table. Do NOT modify these rows directly without recalculating pause credits.
- ⚠️ **Reassigning Delivery Orders:** Payouts are calculated based on route distance. Reassigning a rider must go through `commitRouteChanges` to accurately recalculate `payout_amount` and `route_sequence`.
- ⚠️ **Deleting Profiles:** Never hard-delete profiles. Use `is_active = false`.

## RLS Sensitive Tables
- `users`, `customer_profiles`, `addresses` are heavily protected by Row Level Security.
- The Admin Server Actions bypass RLS using the Service Role Key (`createAdminClient`). This is intentional for complex cross-user state mutations but must be used carefully to prevent unauthorized privilege escalation.
