import { z } from "zod";

export const profileSchema = z
  .object({
    full_name: z.string().min(2, "Full name is required"),
    // Email is optional here: some customers only have an admin-entered
    // placeholder (Test_Email), which is deliberately excluded from
    // customer-facing display, so the field may start out blank. When the
    // customer does provide a value it must be a valid, reasonably sized
    // email address.
    email: z
      .string()
      .max(254, "Email must be at most 254 characters.")
      .refine(
        (v) => v.trim().length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
        "Enter a valid email address.",
      ),
    phone: z.string().regex(/^[6-9]\d{9}$/, "Invalid Indian mobile number"),
    date_of_birth: z.string().min(1, "Date of birth is required"),

    gender: z.enum(["Male", "Female", "Other"], {
      message: "Please select a gender",
    }),

    dietary_preference: z.enum(["Veg", "Non-Veg"], {
      message: "Dietary preference is required",
    }),

    allergies: z.string().min(1, "Please specify allergies or write 'None'"),

    // Removed .default(false) to sync input/output types for React Hook Form
    medical_history_notes: z.string().optional(),
    has_medical_history: z.boolean(),
    no_medical_history_confirmed: z.boolean(),
  })
  .refine(
    (data) => {
      // If they say they DO NOT have history, they MUST check the confirmation box
      if (!data.has_medical_history && !data.no_medical_history_confirmed) {
        return false;
      }
      return true;
    },
    {
      message:
        "You must either provide medical history or explicitly confirm you have none.",
      path: ["no_medical_history_confirmed"],
    },
  );

export type ProfileFormValues = z.infer<typeof profileSchema>;
