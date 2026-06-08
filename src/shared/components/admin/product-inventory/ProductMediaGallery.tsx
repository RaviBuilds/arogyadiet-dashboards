"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { ImagePlus, Star, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

const MAX_FILE_SIZE_MB = 5;

type ExistingGalleryItem = {
  kind: "existing";
  key: string;
  url: string;
};

type NewGalleryItem = {
  kind: "new";
  key: string;
  file: File;
  previewUrl: string;
};

type GalleryItem = ExistingGalleryItem | NewGalleryItem;

export type ProductMediaGalleryHandle = {
  applyToFormData: (formData: FormData) => void;
};

interface ProductMediaGalleryProps {
  existingImages?: string[];
  defaultBannerUrl?: string | null;
  className?: string;
}

function createExistingItem(url: string): ExistingGalleryItem {
  return {
    kind: "existing",
    key: `existing:${url}`,
    url,
  };
}

function createNewItem(file: File): NewGalleryItem {
  return {
    kind: "new",
    key: `new:${file.name}-${file.size}-${file.lastModified}`,
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function buildInitialItems(existingImages: string[]): GalleryItem[] {
  return existingImages.map(createExistingItem);
}

function resolveInitialBannerKey(
  items: GalleryItem[],
  defaultBannerUrl?: string | null,
): string | null {
  if (items.length === 0) {
    return null;
  }

  if (defaultBannerUrl) {
    const matched = items.find(
      (item) => item.kind === "existing" && item.url === defaultBannerUrl,
    );
    if (matched) {
      return matched.key;
    }
  }

  return items[0]?.key ?? null;
}

export const ProductMediaGallery = forwardRef<
  ProductMediaGalleryHandle,
  ProductMediaGalleryProps
>(function ProductMediaGallery(
  { existingImages = [], defaultBannerUrl = null, className },
  ref,
) {
  const [items, setItems] = useState<GalleryItem[]>(() =>
    buildInitialItems(existingImages),
  );
  const [bannerKey, setBannerKey] = useState<string | null>(() =>
    resolveInitialBannerKey(
      buildInitialItems(existingImages),
      defaultBannerUrl,
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const formInputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      if (rejectedFiles.length > 0) {
        setError(
          `Each image must be under ${MAX_FILE_SIZE_MB}MB and in a supported format.`,
        );
      } else {
        setError(null);
      }

      if (acceptedFiles.length === 0) {
        return;
      }

      setItems((prev) => {
        const existingKeys = new Set(prev.map((item) => item.key));
        const nextItems = acceptedFiles
          .map(createNewItem)
          .filter((item) => !existingKeys.has(item.key));

        if (nextItems.length > 0) {
          setBannerKey((current) => current ?? nextItems[0].key);
        }

        return nextItems.length > 0 ? [...prev, ...nextItems] : prev;
      });
    },
    [],
  );

  const { getRootProps, getInputProps, isDragActive, isFocused } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: true,
    maxSize: MAX_FILE_SIZE_MB * 1024 * 1024,
  });

  const newFiles = useMemo(
    () =>
      items.filter((item): item is NewGalleryItem => item.kind === "new").map(
        (item) => item.file,
      ),
    [items],
  );

  useEffect(() => {
    if (!formInputRef.current) {
      return;
    }

    const dataTransfer = new DataTransfer();
    newFiles.forEach((file) => dataTransfer.items.add(file));
    formInputRef.current.files = dataTransfer.files;
  }, [newFiles]);

  useEffect(() => {
    return () => {
      items.forEach((item) => {
        if (item.kind === "new") {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [items]);

  const handleRemove = (key: string, event: React.MouseEvent) => {
    event.stopPropagation();

    setItems((prev) => {
      const removed = prev.find((item) => item.key === key);
      if (removed?.kind === "new") {
        URL.revokeObjectURL(removed.previewUrl);
      }

      const next = prev.filter((item) => item.key !== key);
      setBannerKey((current) =>
        current !== key ? current : (next[0]?.key ?? null),
      );
      return next;
    });

    setError(null);
  };

  const handleSetBanner = (key: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setBannerKey(key);
  };

  useImperativeHandle(ref, () => ({
    applyToFormData(formData: FormData) {
      formData.delete("image");
      formData.delete("existingImageUrls");
      formData.delete("bannerImageUrl");
      formData.delete("bannerNewFileIndex");

      items.forEach((item) => {
        if (item.kind === "existing") {
          formData.append("existingImageUrls", item.url);
        }
      });

      newFiles.forEach((file) => {
        formData.append("image", file);
      });

      const bannerItem = items.find((item) => item.key === bannerKey);

      if (bannerItem?.kind === "existing") {
        formData.set("bannerImageUrl", bannerItem.url);
        formData.set("bannerNewFileIndex", "-1");
        return;
      }

      if (bannerItem?.kind === "new") {
        const bannerNewFileIndex = newFiles.findIndex(
          (file) =>
            file.name === bannerItem.file.name &&
            file.size === bannerItem.file.size &&
            file.lastModified === bannerItem.file.lastModified,
        );
        formData.set("bannerImageUrl", "");
        formData.set(
          "bannerNewFileIndex",
          String(bannerNewFileIndex >= 0 ? bannerNewFileIndex : -1),
        );
        return;
      }

      formData.set("bannerImageUrl", "");
      formData.set("bannerNewFileIndex", "-1");
    },
  }));

  return (
    <div className={cn("space-y-3", className)}>
      <input
        ref={formInputRef}
        type="file"
        name="image"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragActive || isFocused
            ? "border-primary bg-primary/5"
            : "border-input bg-muted/20 hover:border-ring/50 hover:bg-muted/40",
          error && "border-destructive/50",
        )}
      >
        <input {...getInputProps({ className: "sr-only", tabIndex: -1 })} />
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border bg-background">
          <ImagePlus className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">
          {isDragActive ? "Drop images here" : "Drag and drop images"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          or click to browse — PNG, JPG, WEBP up to {MAX_FILE_SIZE_MB}MB each
        </p>
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Gallery preview
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item) => {
              const isBanner = item.key === bannerKey;
              const previewUrl = item.kind === "existing" ? item.url : item.previewUrl;
              const label =
                item.kind === "existing"
                  ? item.url.split("/").pop() ?? "Existing image"
                  : item.file.name;

              return (
                <div
                  key={item.key}
                  className={cn(
                    "group relative overflow-hidden rounded-lg border bg-muted/30",
                    isBanner && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                >
                  <img
                    src={previewUrl}
                    alt={label}
                    className="aspect-square w-full object-cover"
                  />

                  {isBanner ? (
                    <Badge className="absolute top-1.5 left-1.5 px-1.5 py-0 text-[10px]">
                      Banner
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={(event) => handleSetBanner(item.key, event)}
                      className="absolute top-1.5 left-1.5 h-7 gap-1 px-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Star className="h-3 w-3" />
                      Set banner
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={(event) => handleRemove(item.key, event)}
                    className="absolute top-1.5 right-1.5 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove ${label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>

                  <div className="border-t px-2 py-1.5">
                    <p className="truncate text-xs font-medium">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
});
