"use client";

import { useState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Button } from "@/shared/components/ui/button";
import { getSelectableClinics } from "@/actions/admin-actions/clinicSelectorActions";
import { adminAssignCustomerClinic } from "@/actions/admin-actions/customerActions";
import { useRouter } from "next/navigation";

interface ClinicAssignmentSelectorProps {
  profileId: string;
  currentClinicId: string | null;
}

export function ClinicAssignmentSelector({
  profileId,
  currentClinicId,
}: ClinicAssignmentSelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clinics, setClinics] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClinicId, setSelectedClinicId] = useState<string>(
    currentClinicId ?? "unassigned"
  );

  useEffect(() => {
    getSelectableClinics().then((result) => {
      setClinics(result.clinics);
      setLoading(false);
    });
  }, []);

  const handleAssign = () => {
    const clinicIdToSet = selectedClinicId === "unassigned" ? null : selectedClinicId;
    startTransition(async () => {
      const result = await adminAssignCustomerClinic(profileId, clinicIdToSet);
      if (result.success) {
        toast.success("Clinic assigned successfully.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to assign clinic.");
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading clinics...
      </div>
    );
  }

  const hasChanged =
    (currentClinicId ?? "unassigned") !== selectedClinicId;

  return (
    <div className="flex items-center gap-3">
      <Select value={selectedClinicId} onValueChange={setSelectedClinicId}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select a clinic" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {clinics.map((clinic) => (
            <SelectItem key={clinic.id} value={clinic.id}>
              {clinic.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasChanged && (
        <Button
          size="sm"
          onClick={handleAssign}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : null}
          Save
        </Button>
      )}
    </div>
  );
}
