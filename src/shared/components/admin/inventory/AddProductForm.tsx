"use client";

import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { addProductAction } from "@/actions/inventory-actions";
import {
  addProductFormSchema,
  ALLOWED_IMAGE_TYPES,
  BASE_UOMS,
  MAX_IMAGE_SIZE_BYTES,
  PRODUCT_TYPES,
  UNCATEGORIZED_LABEL,
  validateInventoryProductImage,
  type AddProductFormValues,
  type InventoryProductCategory,
} from "@/lib/inventory/product-schema";

import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

const PRODUCT_TYPE_LABELS: Record<(typeof PRODUCT_TYPES)[number], string> = {
  RAW_MATERIAL: "Raw Material",
  FINISHED_GOOD: "Finished Good",
};

const BASE_UOM_LABELS: Record<(typeof BASE_UOMS)[number], string> = {
  KG: "Kilogram (KG)",
  LITRE: "Litre",
  UNIT: "Unit",
};

const defaultValues: AddProductFormValues = {
  name: "",
  category: UNCATEGORIZED_LABEL,
  type: "RAW_MATERIAL",
  baseUom: "KG",
  minStockThreshold: 0,
  defaultDurabilityDays: 0,
};

interface AddProductFormProps {
  onSuccess?: () => void;
  categories?: InventoryProductCategory[];
}

export default function AddProductForm({
  onSuccess,
  categories = [],
}: AddProductFormProps) {
  const [isPending, startTransition] = useTransition();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<AddProductFormValues>({
    resolver: zodResolver(addProductFormSchema),
    defaultValues,
  });

  function clearImageSelection() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setImageFile(null);
    setPreviewUrl(null);
    setImageError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      clearImageSelection();
      return;
    }

    const validationError = validateInventoryProductImage(file);
    if (validationError) {
      setImageError(validationError);
      setImageFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(null);
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setImageError(null);
  }

  function onSubmit(values: AddProductFormValues) {
    if (!imageFile) {
      setImageError("Product image is required.");
      return;
    }

    const validationError = validateInventoryProductImage(imageFile);
    if (validationError) {
      setImageError(validationError);
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("category", values.category);
      formData.append("type", values.type);
      formData.append("baseUom", values.baseUom);
      formData.append("minStockThreshold", String(values.minStockThreshold));
      formData.append(
        "defaultDurabilityDays",
        String(values.defaultDurabilityDays),
      );
      formData.append("image", imageFile);

      const result = await addProductAction(formData);

      if (result.success) {
        toast.success("Product registered successfully.");
        form.reset(defaultValues);
        clearImageSelection();
        onSuccess?.();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Organic Brown Rice" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={UNCATEGORIZED_LABEL}>
                        {UNCATEGORIZED_LABEL}
                      </SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.name}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Manage the list with the &quot;Product Categories&quot; button.
                    Leave as {UNCATEGORIZED_LABEL} if unsure.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormItem>
              <FormLabel>Product Image</FormLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(",")}
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus />
                  Browse Image
                </Button>
                {imageFile && (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {imageFile.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearImageSelection}
                    >
                      <X />
                      Clear
                    </Button>
                  </>
                )}
              </div>
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Product preview"
                  className="mt-2 h-24 w-24 rounded-md object-cover ring-1 ring-border"
                />
              )}
              <p className="text-xs text-muted-foreground">
                Max file size: {MAX_IMAGE_SIZE_BYTES / 1_048_576} MB. JPEG, PNG,
                WebP, or GIF.
              </p>
              {imageError && (
                <p className="text-sm text-destructive">{imageError}</p>
              )}
            </FormItem>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRODUCT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {PRODUCT_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="baseUom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base Unit of Measure</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select UOM" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BASE_UOMS.map((uom) => (
                          <SelectItem key={uom} value={uom}>
                            {BASE_UOM_LABELS[uom]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="minStockThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Stock Threshold</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={field.value}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? 0 : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="defaultDurabilityDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Durability (Days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={field.value}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? 0 : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
              {isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Registering...
                </>
              ) : (
                "Register Product"
              )}
            </Button>
      </form>
    </Form>
  );
}
