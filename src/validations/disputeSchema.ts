import { z } from "zod";

export const DISPUTE_CATEGORIES = [
  "Inventory", "Customer", "Subscriptions", "KIT",
  "Rider", "Shop_Products", "Operations", "Others"
] as const;

export const DISPUTE_STATUSES = ["Open", "Under_Investigation", "Solved"] as const;

export type DisputeCategory = typeof DISPUTE_CATEGORIES[number];
export type DisputeStatus = typeof DISPUTE_STATUSES[number];

export const createDisputeSchema = z.object({
  category: z.enum(DISPUTE_CATEGORIES, { message: "Category is required" }),
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(2000, "Description cannot exceed 2000 characters"),
  related_order_ids: z.array(z.string().uuid()).optional(),
}).refine(
  (data) => {
    if (data.category === "Inventory") {
      return data.related_order_ids && data.related_order_ids.length > 0;
    }
    return true;
  },
  { message: "At least one received order must be selected for Inventory disputes", path: ["related_order_ids"] }
);

export const updateDisputeStatusSchema = z.object({
  dispute_id: z.string().uuid("Invalid dispute ID"),
  status: z.enum(["Under_Investigation", "Solved"]),
  comment: z
    .string()
    .trim()
    .min(10, "Comment must be at least 10 characters")
    .max(1000, "Comment cannot exceed 1000 characters"),
});

// Valid status transitions (Open can go to either Under_Investigation or Solved)
export const VALID_TRANSITIONS: Record<DisputeStatus, DisputeStatus | DisputeStatus[] | null> = {
  Open: ["Under_Investigation", "Solved"],
  Under_Investigation: "Solved",
  Solved: null, // terminal state
};

export function isValidTransition(current: DisputeStatus, next: DisputeStatus): boolean {
  const allowed = VALID_TRANSITIONS[current];
  if (allowed === null) return false;
  if (Array.isArray(allowed)) return allowed.includes(next);
  return allowed === next;
}
