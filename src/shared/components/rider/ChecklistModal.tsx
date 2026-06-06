"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import { Loader2 } from "lucide-react";
import type { ChecklistItem } from "@/lib/delivery/riderChecklist";

export function ChecklistModal({
  open,
  onOpenChange,
  items,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ChecklistItem[];
  onConfirm: () => void;
  isPending: boolean;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setCheckedIds(new Set());
  }, [open, items]);

  const allChecked =
    items.length > 0 && checkedIds.size === items.length;

  const toggleItem = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delivery checklist</DialogTitle>
          <DialogDescription>
            Confirm you have all items before marking this delivery complete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {items.map((item) => {
            const checked = checkedIds.has(item.id);
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3"
              >
                <Checkbox
                  id={item.id}
                  checked={checked}
                  disabled={isPending}
                  onCheckedChange={(value) =>
                    toggleItem(item.id, value === true)
                  }
                />
                <Label
                  htmlFor={item.id}
                  className="cursor-pointer font-semibold leading-snug text-zinc-900"
                >
                  {item.label}
                </Label>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-green-600 hover:bg-green-700"
            disabled={!allChecked || isPending}
            onClick={onConfirm}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              "Confirm Delivery"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
