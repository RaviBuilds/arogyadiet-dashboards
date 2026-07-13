"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  ArrowLeft,
  FolderTree,
  ImagePlus,
  Layers,
  Loader2,
  Package,
  Plus,
  Tags,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { createCategoryAction } from "@/actions/inventory-actions";
import {
  ALLOWED_IMAGE_TYPES,
  categoryFormSchema,
  MAX_IMAGE_SIZE_BYTES,
  UNCATEGORIZED_LABEL,
  validateInventoryProductImage,
  type CategoryFormValues,
  type InventoryCategoryOverview,
} from "@/lib/inventory/product-schema";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";

interface ProductCategoriesDialogProps {
  overview: InventoryCategoryOverview[];
}

export default function ProductCategoriesDialog({
  overview,
}: ProductCategoriesDialogProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "create">("list");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset to the list view whenever the dialog closes.
      setView("list");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Tags />
          Product Categories
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {view === "list" ? (
          <CategoryListView
            overview={overview}
            onCreate={() => setView("create")}
          />
        ) : (
          <CategoryCreateView
            onBack={() => setView("list")}
            onCreated={() => setView("list")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── List / overview view ──────────────────────────────────────────────────

function CategoryListView({
  overview,
  onCreate,
}: {
  overview: InventoryCategoryOverview[];
  onCreate: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FolderTree className="size-5 text-orange-600" />
          Product Categories
        </DialogTitle>
        <DialogDescription>
          Overview of every category with its product count and total stock.
          Create curated categories here, then assign products from the product
          edit screen.
        </DialogDescription>
      </DialogHeader>

      <div className="flex justify-end">
        <Button size="sm" onClick={onCreate}>
          <Plus />
          New Category
        </Button>
      </div>

      {overview.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center">
          <FolderTree className="mb-3 size-9 text-muted-foreground/60" />
          <p className="font-medium text-foreground">No categories yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first category to start organising products.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {overview.map((category) => (
            <CategoryOverviewCard key={category.id ?? "__uncat"} category={category} />
          ))}
        </div>
      )}
    </>
  );
}

function CategoryOverviewCard({
  category,
}: {
  category: InventoryCategoryOverview;
}) {
  const isUncategorized =
    category.id === null || category.name === UNCATEGORIZED_LABEL;

  return (
    <div className="flex gap-3 rounded-lg border border-border/70 bg-white p-3 shadow-sm">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-slate-100">
        {category.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={category.imageUrl}
            alt={category.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="size-6 text-muted-foreground/50" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold text-foreground">
            {category.name}
          </h3>
          {isUncategorized && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Default
            </Badge>
          )}
        </div>
        {category.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {category.description}
          </p>
        ) : (
          <p className="mt-0.5 text-xs italic text-muted-foreground/70">
            No description
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge className="border-0 bg-orange-100 text-orange-800 hover:bg-orange-100">
            <Package className="mr-1 size-3" />
            {category.productCount} product
            {category.productCount === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Layers className="size-3" />
            {category.totalStock} in stock
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ─── Create view ─────────────────────────────────────────────────────────────

function CategoryCreateView({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: "", description: "" },
  });

  function clearImageSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(null);
    setPreviewUrl(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setImageError(null);
  }

  function onSubmit(values: CategoryFormValues) {
    startTransition(async () => {
      const formData = new FormData();
      formData.append("name", values.name);
      if (values.description) {
        formData.append("description", values.description);
      }
      if (imageFile) {
        formData.append("image", imageFile);
      }

      const result = await createCategoryAction(formData);

      if (result.success) {
        toast.success("Category created successfully.");
        form.reset({ name: "", description: "" });
        clearImageSelection();
        router.refresh();
        onCreated();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Plus className="size-5 text-orange-600" />
          New Category
        </DialogTitle>
        <DialogDescription>
          Add a curated category. Product counts update automatically as you
          assign products.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Grains & Cereals" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Description{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="A short description of what belongs in this category."
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormItem>
            <FormLabel>
              Category Image{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FormLabel>
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
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Category preview"
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

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={isPending}
            >
              <ArrowLeft />
              Back
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Category"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}
