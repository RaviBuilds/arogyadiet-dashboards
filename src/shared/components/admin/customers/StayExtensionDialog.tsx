"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";

import {
  extendStaySchema,
} from "@/validations/accommodationSchema";
import { extendStayAction } from "@/actions/stayActions";
import type { z } from "zod";

type FormValues = z.input<typeof extendStaySchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StayExtensionDialogProps {
  stayId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for extending an active stay by adding additional nights
 * with a separate payment amount (GST inclusive).
 *
 * Requirements: 13.8, 14.1, 14.2, 14.6
 */
export function StayExtensionDialog({
  stayId,
  open,
  onOpenChange,
  onSuccess,
}: StayExtensionDialogProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(extendStaySchema),
    defaultValues: {
      additionalNights: undefined,
      paymentAmount: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await extendStayAction(stayId, values as { additionalNights: number; paymentAmount: number });

      if ("success" in result && result.success) {
        toast.success(`Stay extended to ${result.data.newEndDate}`);
        form.reset();
        onOpenChange(false);
        onSuccess();
      } else if ("error" in result) {
        toast.error(result.error);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Extend Stay</DialogTitle>
          <DialogDescription>
            Add additional nights to the current active stay with a new payment.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="additionalNights"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Nights</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      placeholder="e.g. 7"
                      value={field.value != null ? String(field.value) : ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value)
                        )
                      }
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paymentAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Amount (₹, GST inclusive)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={9999999}
                      placeholder="e.g. 25000"
                      value={field.value != null ? String(field.value) : ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value)
                        )
                      }
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Extend Stay
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
