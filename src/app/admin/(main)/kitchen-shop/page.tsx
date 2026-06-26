import { redirect } from "next/navigation";
import { guardAdminPage } from "@/lib/auth/adminAccess";

export default async function KitchenShopPage() {
  await guardAdminPage("operations");
  redirect("/kitchen-shop/inventory");
}
