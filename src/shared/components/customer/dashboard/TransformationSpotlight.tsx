"use client";

import Image from "next/image";
import { useState } from "react";
import { Play, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/**
 * TransformationSpotlight — the motivation zone, powered by a real ArogyaDiet
 * success story.
 *
 * The original transformation banner is itself a complete storytelling asset
 * (before/after, headline, quote, branding), so it is presented uncropped as
 * the visual hero. Supporting copy and the call-to-action live *outside* the
 * image so nothing is obscured. The CTA opens the customer's full interview in
 * an in-app YouTube modal, keeping the user immersed in the experience.
 *
 * Reusable across every customer type by passing a different story + video.
 */
type TransformationSpotlightProps = {
  imageSrc: string;
  /** Intrinsic banner size so it renders uncropped without distortion. */
  imageWidth: number;
  imageHeight: number;
  headline: string;
  subtext: string;
  ctaLabel?: string;
  youtubeId: string;
  youtubeStart?: number;
  imageAlt?: string;
};

export function TransformationSpotlight({
  imageSrc,
  imageWidth,
  imageHeight,
  headline,
  subtext,
  ctaLabel = "Watch Full Journey",
  youtubeId,
  youtubeStart = 0,
  imageAlt = "A real ArogyaDiet transformation journey",
}: TransformationSpotlightProps) {
  const [open, setOpen] = useState(false);
  const embedSrc = `https://www.youtube.com/embed/${youtubeId}?start=${youtubeStart}&autoplay=1&rel=0&modestbranding=1`;

  return (
    // Closes the reveal cascade — arrives last so the opening reads as one
    // unified welcome (hero → today → momentum → transformation).
    <section
      className="reveal-rise overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50/70 via-white to-white shadow-sm"
      style={{ ["--reveal-delay" as string]: "500ms" }}
    >
      {/* Supporting copy + CTA (kept off the image so it's never obscured) */}
      <div className="relative overflow-hidden">
        {/* Extremely subtle botanical line art so this intro never feels like
            an empty white rectangle. Opacity kept very low. */}
        <svg
          className="pointer-events-none absolute -right-6 -top-8 h-48 w-48 text-emerald-600/[0.07]"
          viewBox="0 0 200 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {/* Lotus / leaf outline cluster */}
          <path d="M100 170 C 100 120, 70 90, 40 70" />
          <path d="M100 170 C 100 120, 130 90, 160 70" />
          <path d="M100 170 C 100 110, 100 70, 100 40" />
          <path d="M100 170 C 96 120, 76 96, 58 96 C 68 122, 88 150, 100 170 Z" />
          <path d="M100 170 C 104 120, 124 96, 142 96 C 132 122, 112 150, 100 170 Z" />
          <path d="M100 170 C 88 118, 88 74, 100 40 C 112 74, 112 118, 100 170 Z" />
        </svg>

        <div className="relative flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
              <Sparkles className="h-3.5 w-3.5" />
              Real Transformations
            </span>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              {headline}
            </h3>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
              {subtext}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
          >
            <Play className="h-4 w-4 fill-current" />
            {ctaLabel}
          </button>
        </div>
      </div>

      {/* The original banner as the visual hero — uncropped, tappable to play */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Play the full transformation story: ${headline}`}
        className="group relative block w-full cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <Image
          src={imageSrc}
          alt={imageAlt}
          width={imageWidth}
          height={imageHeight}
          sizes="(max-width: 1024px) 100vw, 1024px"
          className="h-auto w-full"
        />
        {/* Play affordance — subtle, only hints the banner is watchable */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="play-pulse-once flex h-16 w-16 items-center justify-center rounded-full bg-white/85 text-primary shadow-lg ring-1 ring-black/5 backdrop-blur-sm transition-transform duration-200 group-hover:scale-105">
            <Play className="ml-0.5 h-7 w-7 fill-current" />
          </span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="max-w-3xl overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogTitle className="sr-only">
            {headline} — full transformation story
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
    </section>
  );
}
