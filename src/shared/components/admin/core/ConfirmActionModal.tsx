"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isPending?: boolean;
  variant?: "destructive" | "default";
}

export function ConfirmActionModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm Action",
  description = "Are you sure you want to continue?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isPending = false,
  variant = "default",
}: ConfirmActionModalProps) {
  const isDestructive = variant === "destructive";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle
            className={cn(
              "flex items-center gap-2",
              isDestructive ? "text-destructive" : "text-foreground",
            )}
          >
            <AlertTriangle
              className={cn(
                "h-5 w-5 shrink-0",
                isDestructive ? "text-destructive" : "text-amber-500",
              )}
            />
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 pt-2 text-sm text-muted-foreground">
              {typeof description === "string" ? (
                <p className="leading-relaxed">{description}</p>
              ) : (
                description
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            variant={isDestructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
