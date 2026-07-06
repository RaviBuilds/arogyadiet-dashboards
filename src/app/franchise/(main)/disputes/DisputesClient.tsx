"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquareWarning } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import RaiseDisputeForm from "./RaiseDisputeForm";
import DisputeHistoryTable from "./DisputeHistoryTable";
import type { Dispute } from "@/types/dispute";

interface Props {
  disputes: Dispute[];
}

export default function DisputesClient({ disputes }: Props) {
  const router = useRouter();

  function handleSuccess() {
    toast.success("Dispute raised successfully!");
    router.refresh();
  }

  function handleError(message: string) {
    toast.error(message || "Failed to create dispute. Please try again.");
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Disputes"
        subtitle="Raise and track disputes with the master admin."
        icon={MessageSquareWarning}
      />

      <RaiseDisputeForm onSuccess={handleSuccess} onError={handleError} />

      <DisputeHistoryTable disputes={disputes} />
    </div>
  );
}
