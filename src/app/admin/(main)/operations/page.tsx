
import { createClient } from "@/lib/supabase/server";
import OperationsClientTable from "./OperationsClientTable";

export default async function OperationsPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().split('T')[0];
 const { data: rawDeliveries, error } = await supabase
   .from("delivery_orders")
   .select(
     `
       id,
       status,
       delivery_date,
       customer_profiles ( users ( full_name, mobile ) ),
       rider_profiles ( users ( full_name ) ),
       addresses ( pincode, street_1 ), 
       meal_categories ( name ),
       addon_orders ( 
         addon_order_items ( quantity, products ( name ) ) 
       )
     `,
   )
   .eq("delivery_date", today);

  if (error) {
    console.error("Error fetching deliveries:", error);
    return <div>Error fetching deliveries.</div>;
  }

  // TODO: Process rawDeliveries into a format suitable for OperationsClientTable
  // For now, just display raw data
  return (
    <div className="flex flex-col gap-5 p-5">
      <h1 className="text-2xl font-bold">Delivery Operations Board</h1>
      <OperationsClientTable data={rawDeliveries} />
    </div>
  );
}
