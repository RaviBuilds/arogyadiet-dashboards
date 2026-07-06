"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Download, X } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { getPackageImageUrls } from "@/actions/admin-actions/packageImageActions";

interface PackageImagesViewerProps {
  /** The transfer ID to fetch package images for */
  transferId: string;
  /** Compact icon-only trigger (for ledger tables) */
  compact?: boolean;
}

/**
 * Displays package images attached to a franchise dispatch transfer.
 * Shows a camera icon that opens a dialog with all images.
 * Only renders when the transfer has images (checks via server action).
 */
export default function PackageImagesViewer({
  transferId,
  compact = false,
}: PackageImagesViewerProps) {
  const [imageUrls, setImageUrls] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchImages() {
      setIsLoading(true);
      const result = await getPackageImageUrls(transferId);
      if (!cancelled) {
        setImageUrls(result.success ? result.urls : null);
        setIsLoading(false);
      }
    }

    fetchImages();
    return () => { cancelled = true; };
  }, [transferId]);

  // Keyboard navigation for the fullscreen preview
  useEffect(() => {
    if (previewIndex === null || !imageUrls) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPreviewIndex(null);
      } else if (e.key === "ArrowRight") {
        setPreviewIndex((prev) =>
          prev !== null && imageUrls ? (prev + 1) % imageUrls.length : null
        );
      } else if (e.key === "ArrowLeft") {
        setPreviewIndex((prev) =>
          prev !== null && imageUrls
            ? (prev - 1 + imageUrls.length) % imageUrls.length
            : null
        );
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [previewIndex, imageUrls]);

  const handleDownload = useCallback(async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `package-photo-${index + 1}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback: open in new tab if download fails (CORS issue)
      window.open(url, "_blank");
    }
  }, []);

  // Don't render anything if no images exist or still loading with no data
  if (isLoading || !imageUrls || imageUrls.length === 0) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {compact ? (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="View package photos"
              title="View package photos"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="gap-1.5">
              <Camera className="h-3.5 w-3.5" />
              Package Photos ({imageUrls.length})
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Package Photos
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {imageUrls.map((url, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setPreviewIndex(idx)}
                className="group relative aspect-square overflow-hidden rounded-lg border bg-slate-50 transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
              >
                <img
                  src={url}
                  alt={`Package photo ${idx + 1}`}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {imageUrls.length} photo{imageUrls.length === 1 ? "" : "s"} · Click to preview
          </p>
        </DialogContent>
      </Dialog>

      {/* Fullscreen image preview overlay */}
      {previewIndex !== null && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setPreviewIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          {/* Top bar with close and download */}
          <div
            className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-white/80 text-sm font-medium">
              {previewIndex + 1} / {imageUrls.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownload(imageUrls[previewIndex], previewIndex)}
                className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
                aria-label="Download image"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
              <button
                type="button"
                onClick={() => setPreviewIndex(null)}
                className="rounded-md bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                aria-label="Close preview"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Navigation arrows */}
          {imageUrls.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewIndex(
                    (previewIndex - 1 + imageUrls.length) % imageUrls.length
                  );
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 z-10"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewIndex((previewIndex + 1) % imageUrls.length);
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 z-10"
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* Full-size image */}
          <img
            src={imageUrls[previewIndex]}
            alt={`Package photo ${previewIndex + 1}`}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
