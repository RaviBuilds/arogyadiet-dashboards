import { UpdatePasswordForm } from "@/shared/components/forms/update-password-form";
import Image from "next/image";

export default function FranchiseUpdatePasswordPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center bg-white p-4 rounded-2xl shadow-sm self-center">
          <Image
            src="/logo.png"
            alt="ArogyaDiet"
            width={180}
            height={60}
            priority
            className="h-auto w-auto"
          />
        </div>
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
