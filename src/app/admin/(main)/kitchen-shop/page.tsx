import { redirect } from "next/navigation";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export default async function KitchenShopPage() {
  await guardAdminGroup("shop_products");
  redirect("/kitchen-shop/inventory");
}
