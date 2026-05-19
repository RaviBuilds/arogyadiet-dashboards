
import { toast } from "sonner";

export const AdminToast = {
  success: (title: string, description?: string) => {
    toast.success(title, {
      description,
      duration: 4000,
    });
  },
  error: (title: string, description?: string) => {
    toast.error(title, {
      description,
      duration: 5000,
    });
  },
  info: (title: string, description?: string) => {
    toast.info(title, {
      description,
      duration: 4000,
    });
  }
};
