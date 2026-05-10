import { z } from "zod";

export const profileSchema = z.object({
  full_name: z.string().min(2, "Name is required"),
  email: z.string().email(),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Invalid Indian mobile number"),
  date_of_birth: z.string().optional(), // Required by SRS Table 6
  gender: z.enum(["Male", "Female", "Other"]).optional(), // Required by SRS Table 6
  dietary_preference: z.enum(["Veg", "Non-Veg"]),
  allergies: z.string().optional(),
  medical_history_notes: z.string().optional(),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
