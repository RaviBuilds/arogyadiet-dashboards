"use client";

import { useState } from "react";
import { Play, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { RotatingFoodImage } from "@/shared/components/customer/dashboard/RotatingFoodImage";

/**
 * TransformationStories — the "Real Transformation" moment on My Meals.
 *
 * Reuses RotatingFoodImage for the exact crossfade mechanic the brief asked
 * for (one image visible, calm auto-crossfade, no arrows/dots/controls) —
 * rather than building a second carousel primitive. Copy stays generic and
 * non-fabricated: there's no database record tying these photos to a real
 * name/weight/duration, so per the brief's own fallback rule we show image +
 * encouragement only, never invented specifics.
 *
 * The "View Full Journey" CTA reuses the same Dialog + YouTube-embed pattern
 * as TransformationSpotlight (dashboard) so it opens the same real customer
 * video — duplicated here rather than reusing that component directly since
 * its layout (large single banner + external copy) doesn't fit this card.
 */
const TESTIMONIAL_IMAGES = [
  "/testimonail-1.jpeg",
  "/testimonail-2.jpeg",
  "/testimonail-3.jpeg",
  "/testimonail-4.jpeg",
  "/testimonail-5.jpeg",
];

export function TransformationStories({
  youtubeId = "yzqZ-yTll8M",
  youtubeStart = 8,
}: {
  youtubeId?: string;
  youtubeStart?: number;
}) {
  const [open, setOpen] = useState(false);
  const embedSrc = `https://www.youtube.com/embed/${youtubeId}?start=${youtubeStart}&autoplay=1&rel=0&modestbranding=1`;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-primary/10 bg-white shadow-sm">
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden">
        <RotatingFoodImage
          images={TESTIMONIAL_IMAGES}
          alt="A real ArogyaDiet transformation story"
          intervalMs={4500}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary shadow-sm backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5" />
          Real Transformations
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3 p-6">
        <p className="text-sm font-medium leading-relaxed text-slate-600">
          Consistency changed my life.
        </p>
        <p className="text-xs leading-relaxed text-slate-500">
          Small healthy choices, made every day, create big transformations.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group mt-1 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
        >
          <Play className="h-4 w-4 fill-current" />
          View Full Journey
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="max-w-3xl overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogTitle className="sr-only">
            A real ArogyaDiet transformation story
          </DialogTitle>
          <div className="aspect-video w-full bg-black">
            {open ? (
              <iframe
                src={embedSrc}
                title="ArogyaDiet transformation story"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
