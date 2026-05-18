import { revalidatePath } from "next/cache";

export async function revalidateOperationsPage() {
  revalidatePath("/admin/(main)/operations");
}