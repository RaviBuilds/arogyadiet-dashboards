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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import {
  createStaySchema,
} from "@/validations/accommodationSchema";
import { createNewStayAction } from "@/actions/stayActions";
import type { z } from "zod";

type FormValues = z.input<typeof createStaySchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewStayDialogProps {
  customerProfileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for creating a new stay entry for a returning guest.
 * Only available when the customer has no ACTIVE or PENDING stay.
 *
 * Requirements: 13.7, 14.3, 14.4, 14.5
 */
export function NewStayDialog({
  customerProfileId,
  open,
  onOpenChange,
  onSuccess,
}: NewStayDialogProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(createStaySchema),
    defaultValues: {
      startDate: "",
      totalNights: undefined,
      stayType: undefined,
      occupancyType: undefined,
      paymentAmount: undefined,
      mealPreference: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createNewStayAction(customerProfileId, values as {
        startDate: string;
        totalNights: number;
        stayType: "AC Villa" | "Village Style Hut";
        occupancyType: "Single" | "Double";
        paymentAmount: number;
        mealPreference: "VEG" | "EGG" | "CHICKEN";
      });

      if ("success" in result && result.success) {
        toast.success("New stay created");
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Stay</DialogTitle>
          <DialogDescription>
            Create a new stay entry for this returning guest.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="totalNights"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Nights</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        placeholder="e.g. 14"
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="stayType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stay Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="AC Villa">AC Villa</SelectItem>
                        <SelectItem value="Village Style Hut">
                          Village Style Hut
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="occupancyType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Occupancy Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select occupancy" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Single">Single</SelectItem>
                        <SelectItem value="Double">Double</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        placeholder="e.g. 50000"
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
                name="mealPreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meal Preference</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select meal" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="VEG">Veg</SelectItem>
                        <SelectItem value="EGG">Egg</SelectItem>
                        <SelectItem value="CHICKEN">Chicken</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                Create Stay
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
