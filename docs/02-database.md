# Database Architecture & Entities

This document outlines the core Supabase database entities and their relationships for the Arogyadiet application.

## Core Principles & Access Control

*   **Row Level Security (RLS):** Supabase uses PostgreSQL RLS to ensure users can only access their own data. Standard client calls operate within these constraints.
*   **Service Role (`createAdminClient`):** For complex background transactions, bulk operations, or administrative tasks that need to bypass RLS, we use the `createAdminClient()` helper. This utility leverages the `SUPABASE_SERVICE_ROLE_KEY` to interact directly with the database without RLS restrictions. This is heavily utilized in `src/actions/admin-actions` and background task handlers.

---

## 1. User Management

The system uses a role-based architecture built on top of Supabase Auth. The primary `users` table acts as a central hub, linking to role-specific profile tables.

*   **`users`**: The core entity linked to `auth.users` (Supabase Auth). It stores common information like `full_name`, `email`, `mobile`, and links to a specific `role_id` (via the `roles` table).
*   **`customer_profiles`**: Extends the `users` table for end customers.
    *   **Relationships:** `user_id` -> `users(id)`.
    *   **Details:** Stores customer-specific data like `customer_code`, `date_of_birth`, `dietary_preference`, `allergies`, and medical history notes.
*   **`rider_profiles`**: Extends the `users` table for delivery personnel.
    *   **Relationships:** `user_id` -> `users(id)`.
    *   **Details:** Stores delivery-specific data like `employee_code`, `joining_date`, `is_online` status, and timestamps for tracking shifts (`last_online_at`, `last_offline_at`).

## 2. Subscription Engine

The core revenue driver is the subscription model, managing recurring meal deliveries.

*   **`subscription_plans`**: Defines the available plans a customer can purchase.
    *   **Details:** `duration_days`, `pause_credits`, `price`, and `is_active` status.
*   **`subscriptions`**: Represents an active or historical purchase of a plan by a customer.
    *   **Relationships:** `customer_profile_id` -> `customer_profiles(id)`, `plan_id` -> `subscription_plans(id)`.
    *   **Details:** Tracks the lifecycle (`starts_on`, `ends_on`, `effective_end_on`), `status`, and usage of pause credits (`consumed_days`, `pause_credits_used`).
*   **`subscription_daily_preferences`**: A critical transactional table detailing what needs to be delivered on a specific day for a subscription.
    *   **Relationships:** `subscription_id` -> `subscriptions(id)`, `customer_profile_id` -> `customer_profiles(id)`, `meal_category_id` -> `meal_categories(id)`, `delivery_address_id` -> `addresses(id)`.
    *   **Details:** Handles day-to-day choices (`preference_date`) and pause states (`is_paused`, `pause_credit_used`).

## 3. Delivery Logistics

Entities responsible for getting meals from the kitchen to the customer.

*   **`addresses`**: Stores delivery locations for customers.
    *   **Relationships:** `customer_profile_id` -> `customer_profiles(id)`.
    *   **Details:** Standard address fields, coordinates (`lat`, `lng`), and an `is_primary` flag.
*   **`delivery_batches`**: Represents a grouping of orders assigned to a rider for a specific shift.
    *   **Relationships:** `assigned_rider_id` -> `rider_profiles(id)`.
    *   **Details:** `delivery_date`, `total_distance_km`, and `expected_payout`.
*   **`delivery_orders`**: The actionable unit for delivery, generated daily based on subscriptions or ad-hoc orders.
    *   **Relationships:** Links multiple domains: `customer_profile_id`, `assigned_rider_id`, `meal_category_id`, `delivery_address_id`, and `batch_id`.
    *   **Details:** Tracks the granular status (`ORDER_CREATED`, `ASSIGNED`, `OUT_FOR_DELIVERY`, `DELIVERED`, etc.), `delivery_date`, `payout_amount`, and timestamps (`pickup_marked_at`, `delivered_at`).

## 4. Kitchen & Meals

Entities defining the products and their source.

*   **`kitchens`**: Defines the originating point for deliveries.
    *   **Details:** Name, address text, and geographic coordinates (`lat`, `lng`).
*   **`meal_categories`**: Categorizes the types of meals offered in the subscriptions (e.g., Keto, Balanced).
    *   **Details:** `code`, `name`.
*   **`products`**: For ad-hoc shop items or add-ons (separate from subscriptions).
    *   **Details:** `sku`, `name`, `original_price`, `sale_price`, and stock tracking.
