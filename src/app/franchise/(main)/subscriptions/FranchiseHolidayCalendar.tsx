"use client";

import { HolidayCalendarClient } from "@/shared/components/admin/subscriptions/HolidayCalendarClient";
import {
  franchiseGetHolidaysForMonth,
  franchiseSaveHolidaysForMonth,
} from "@/actions/franchise-actions/franchiseMarketingActions";

/**
 * Holiday calendar manager for a franchise. Reuses the shared
 * HolidayCalendarClient but wires it to franchise-scoped actions. Holidays
 * created here are only visible to this franchise's customers in their meal
 * planner.
 */
export default function FranchiseHolidayCalendar() {
  return (
    <HolidayCalendarClient
      getHolidaysAction={franchiseGetHolidaysForMonth}
      saveHolidaysAction={franchiseSaveHolidaysForMonth}
      title="Franchise Holiday Calendar"
      description="Add holiday names for each day. Your franchise customers will see these in their meal planner. Holidays are informational only and do not pause deliveries."
    />
  );
}
