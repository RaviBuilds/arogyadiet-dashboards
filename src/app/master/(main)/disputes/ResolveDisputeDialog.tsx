"use client";

import { useState } from "react";
import type { DisputeWithFranchiseName } from "@/types/dispute";
import type { DisputeStatus } from "@/validations/disputeSchema";
import { updateDisputeStatusAction } from "@/actions/master-actions/disputeActions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Label } from "@/shared/components/ui/label";

interface Props {
  dispute: DisputeWithFranchiseName;
  targetStatus: DisputeStatus;
  onSuccess: () => void;
  onError: (message: string) => void;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: DisputeStatus; label: string }[] = [
  { value: "Under_Investigation", label: "Under Investigation" },
  { value: "Solved", label: "Solved" },
];

const BUTTON_LABELS: Record<string, string> = {
  Under_Investigation: "Mark as Under Investigation",
  Solved: "Mark as Solved",
};

export default function ResolveDisputeDialog({
  dispute,
  targetStatus: initialTargetStatus,
  onSuccess,
  onError,
  onClose,
}: Props) {
  const [selectedStatus, setSelectedStatus] = useState<DisputeStatus>(initialTargetStatus);
  const [comment, setComment] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine which status options are valid for this dispute
  const availableStatuses = STATUS_OPTIONS.filter((opt) => {
    if (dispute.status === "Open") return true; // Open can go to either
    if (dispute.status === "Under_Investigation") return opt.value === "Solved";
    return false;
  });

  function validate(): boolean {
    const trimmed = comment.trim();
    if (trimmed.length < 10) {
      setValidationError("Comment must be at least 10 characters");
      return false;
    }
    if (trimmed.length > 1000) {
      setValidationError("Comment cannot exceed 1000 characters");
      return false;
    }
    setValidationError(null);
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("dispute_id", dispute.id);
      formData.append("status", selectedStatus);
      formData.append("comment", comment.trim());

      const result = await updateDisputeStatusAction(formData);

      if (result.success) {
        onSuccess();
      } else {
        onError(result.error ?? "Failed to update dispute status.");
      }
    } catch {
      onError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update Dispute Status</DialogTitle>
          <DialogDescription>
            {dispute.category.replace(/_/g, " ")} dispute from{" "}
            <span className="font-medium text-foreground">
              {dispute.franchise_name}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Full dispute description */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Dispute Description</Label>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 max-h-32 overflow-y-auto">
            {dispute.description}
          </div>
        </div>

        {/* Status selection dropdown */}
        <div className="space-y-1.5">
          <Label htmlFor="status-select">Update Status To</Label>
          <Select
            value={selectedStatus}
            onValueChange={(val) => setSelectedStatus(val as DisputeStatus)}
            disabled={isSubmitting}
          >
            <SelectTrigger id="status-select" className="w-full">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {availableStatuses.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Comment */}
        <div className="space-y-1.5">
          <Label htmlFor="resolve-comment">
            Comment <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="resolve-comment"
            placeholder="Add your comment (minimum 10 characters)..."
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (validationError) setValidationError(null);
            }}
            rows={4}
            maxLength={1000}
            aria-invalid={!!validationError}
            disabled={isSubmitting}
          />
          <div className="flex items-center justify-between">
            {validationError ? (
              <p className="text-xs text-destructive">{validationError}</p>
            ) : (
              <span />
            )}
            <p className="text-xs text-muted-foreground">
              {comment.length}/1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : BUTTON_LABELS[selectedStatus]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
