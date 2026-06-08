import { z } from "zod";

export const adminDisplayNameSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(100, "Display name must be 100 characters or fewer"),
});

export type AdminDisplayNameValues = z.infer<typeof adminDisplayNameSchema>;

export const adminPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Existing password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from your existing password",
    path: ["newPassword"],
  });

export type AdminPasswordValues = z.infer<typeof adminPasswordSchema>;
