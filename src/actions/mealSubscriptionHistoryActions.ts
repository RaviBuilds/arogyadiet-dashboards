"use server";

// src/actions/mealSubscriptionHistoryActions.ts
//
// Server Action boundary for the customer-facing MEAL Subscription History
// page. Authenticates the customer via the shared customer session helper,
// then reads their meal subscriptions through the repository. The per-
// subscription Health Report PDF is streamed by the Route Handler at
// `/api/meal-health-report/[subscriptionId]`, not here.

import { getCustomerSession } from "@/lib/customer/get-session";
import {
  getMealSubscriptionsForCustomer,
  type MealSubscriptionRow,
} from "@/repositories/healthReportRepository";

export type MealSubscriptionHistoryResult =
  | { success: true; subscriptions: MealSubscriptionRow[] }
  | { success: false; error: string };

/**
 * Read the authenticated customer's MEAL subscription history, newest first.
 * Returns an error result (never throws) so the page can render a friendly
 * message.
 */
export async function getMealSubscriptionHistoryAction(): Promise<MealSubscriptionHistoryResult> {
  const { user, customerProfileId, error } = await getCustomerSession();

  if (error || !user || !customerProfileId) {
    return { success: false, error: "You must be signed in to view your subscription history." };
  }

  try {
    const subscriptions = await getMealSubscriptionsForCustomer(customerProfileId);
    return { success: true, subscriptions };
  } catch (err) {
    console.error("[mealSubscriptionHistoryActions] getMealSubscriptionHistoryAction error", err);
    return { success: false, error: "Unable to load your subscription history right now." };
  }
}
