"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { createKitProductAction } from "@/actions/admin-actions/kitProductActions";

/**
 * Add KIT Product Dialog Component
 * 
 * Modal dialog for creating new KIT products with form validation.
 * Uses React Hook Form with Zod schema for client-side validation.
 * 
 * Requirements: 1.3
 * Task: 4.3
 */

// Validation schema matching server-side validation in kitProductActions.ts
const addKitProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(100, "Product name must be 100 characters or less"),
  price: z
    .number({ message: "Price must be a number" })
    .positive("Price must be greater than 0")
    .max(1000000, "Price exceeds maximum allowed value"),
});

type AddKitProductFormInput = z.infer<typeof addKitProductSchema>;

export function AddKitProductDialog() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<AddKitProductFormInput>({
    resolver: zodResolver(addKitProductSchema),
    defaultValues: {
      name: "",
      price: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createKitProductAction(values.name, values.price);

      if (result.success) {
        toast.success(`KIT product "${values.name}" created successfully.`);
        form.reset();
        setIsOpen(false);
        router.refresh();
      } else {
        // Show server-side validation error
        toast.error(result.error);
        
        // Set form error on name field if the error is name-specific
        if (result.error.toLowerCase().includes("name")) {
          form.setError("name", { message: result.error });
        } else if (result.error.toLowerCase().includes("price")) {
          form.setError("price", { message: result.error });
        }
      }
    });
  });

  const handleOpenChange = (open: boolean) => {
    if (!open && !isPending) {
      // Reset form when closing dialog
      form.reset();
    }
    setIsOpen(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add KIT Product
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add KIT Product</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Product Name Field */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Weightloss Premium"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Price Field */}
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price (₹)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="e.g. 19760"
                      step="0.01"
                      min="1"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Convert to number or undefined if empty
                        field.onChange(value === "" ? undefined : parseFloat(value));
                      }}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Product"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
