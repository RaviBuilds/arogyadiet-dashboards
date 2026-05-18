import { createClient } from "@/lib/supabase/server";
import RiderManagement, {
  RiderData,
} from "@/shared/components/admin/riders/RiderManagement";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";

export const revalidate = 0;

export default async function RidersPage() {
  const supabase = await createClient();

  const getISTDateString = (offsetDays = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };
  const today = getISTDateString(0);

  const [ridersRes, areasRes] = await Promise.all([
    supabase
      .from("rider_profiles")
      .select(
        `id, employee_code, is_online, emergency_contact, created_at, users!inner (id, full_name, mobile, email), rider_service_areas (pincode), delivery_batches (id, status, expected_payout, created_at, delivery_date, delivery_orders (id, status))`,
      ),
    supabase
      .from("rider_service_areas")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  if (ridersRes.error) console.error("Error fetching riders:", ridersRes.error);

  const riders: RiderData[] = (ridersRes.data || []).map((rider: any) => {
    const serviceAreas =
      rider.rider_service_areas?.map((area: any) => area.pincode) || [];
    const todaysBatches = (rider.delivery_batches || []).filter(
      (b: any) => b.delivery_date === today,
    );
    let totalOrders = 0,
      completedOrders = 0,
      expectedEarning = 0,
      latestBatchStatus = "No Batch Assigned",
      latestBatchTime = "N/A";

    if (todaysBatches.length > 0) {
      const activeBatch = todaysBatches.sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];
      latestBatchStatus = activeBatch.status;
      latestBatchTime = activeBatch.created_at;
      todaysBatches.forEach((batch: any) => {
        expectedEarning += Number(batch.expected_payout || 0);
        const orders = batch.delivery_orders || [];
        totalOrders += orders.length;
        completedOrders += orders.filter(
          (o: any) => o.status === "DELIVERED",
        ).length;
      });
    }

    return {
      id: rider.id,
      userId: rider.users?.id || "",
      fullName: rider.users?.full_name || "N/A",
      email: rider.users?.email || "N/A",
      mobile: rider.users?.mobile || "N/A",
      emergency_contact: rider.emergency_contact || "N/A",
      employee_code: rider.employee_code || "N/A",
      is_online: rider.is_online || false,
      status_updated_at: rider.created_at || new Date().toISOString(),
      assigned_pincodes: serviceAreas,
      todayCompletedDeliveries: completedOrders,
      todayTotalDeliveries: totalOrders,
      todayEstimatedEarning: expectedEarning,
      latestBatchStatus,
      latestBatchTime,
    };
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Operations & Riders"
        description="Manage delivery personnel, daily activity, service areas, and onboarding."
      />
      <RiderManagement data={riders} allAreas={areasRes.data || []} />
    </div>
  );
}
